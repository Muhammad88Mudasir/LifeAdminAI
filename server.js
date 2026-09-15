require("dotenv").config();

const express = require("express");
const path = require("path");

const {
  initializeApp,
  cert,
  getApps
} = require("firebase-admin/app");

const {
  getFirestore,
  FieldValue
} = require("firebase-admin/firestore");

const {
  getMessaging
} = require("firebase-admin/messaging");

const app = express();

app.use(express.json({ limit: "1mb" }));

/* =========================
   FIREBASE ADMIN
========================= */

let firebaseReady = false;
let db = null;
let messaging = null;

try {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccountRaw) {
    let serviceAccount;

    try {
      serviceAccount = JSON.parse(serviceAccountRaw);
    } catch (error) {
      console.error("FIREBASE_SERVICE_ACCOUNT JSON is invalid.");
    }

    if (serviceAccount) {
      if (!getApps().length) {
        initializeApp({
          credential: cert(serviceAccount)
        });
      }

      db = getFirestore();
      messaging = getMessaging();

      firebaseReady = true;

      console.log("Firebase Admin connected.");
    }
  } else {
    console.log("FIREBASE_SERVICE_ACCOUNT is missing.");
  }
} catch (error) {
  console.error("Firebase initialization error:", error.message);
}

/* =========================
   STATIC WEBSITE
========================= */

app.use(express.static(path.join(__dirname, "public")));

/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Life Admin AI",
    firebase: firebaseReady
  });
});

/* =========================
   AI API
========================= */

app.post("/api/ai", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "AI service is not configured."
      });
    }

    const prompt = `
You are Life Admin AI, a helpful personal task and reminder assistant.

User message:
${message}

Your job is to understand what the user wants.

If the user wants to create a task/reminder, return JSON only:

{
  "action": "add_task",
  "title": "short task title",
  "date": "YYYY-MM-DD",
  "time": "HH:MM"
}

If the user wants to delete a task:

{
  "action": "delete_task",
  "title": "task title"
}

If the user wants to edit a task:

{
  "action": "edit_task",
  "oldTitle": "old task title",
  "newTitle": "new task title",
  "date": "YYYY-MM-DD",
  "time": "HH:MM"
}

If the user is simply asking a question or chatting:

{
  "action": "chat",
  "reply": "helpful response"
}

Use the current date when interpreting words like today, tomorrow, etc.

Return valid JSON only.
`;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://life-admin-ai-gamma.vercel.app",
          "X-Title": "Life Admin AI"
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.2
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenRouter error:", data);

      return res.status(response.status).json({
        error: "AI service is temporarily unavailable."
      });
    }

    const text =
      data?.choices?.[0]?.message?.content || "";

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const cleaned = text
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      try {
        parsed = JSON.parse(cleaned);
      } catch (error2) {
        parsed = {
          action: "chat",
          reply: text
        };
      }
    }

    return res.json(parsed);

  } catch (error) {
    console.error("AI API error:", error);

    return res.status(500).json({
      error: "Something went wrong with the AI."
    });
  }
});

/* =========================
   REGISTER PUSH TOKEN
========================= */

app.post("/api/register-token", async (req, res) => {
  try {
    if (!firebaseReady || !db) {
      return res.status(503).json({
        error: "Firebase is not configured."
      });
    }

    const {
      uid,
      token,
      timezone
    } = req.body;

    if (!uid || !token) {
      return res.status(400).json({
        error: "uid and token are required."
      });
    }

    const safeTimezone =
      typeof timezone === "string" && timezone.length <= 100
        ? timezone
        : "Asia/Karachi";

    const tokenRef = db
      .collection("notificationTokens")
      .doc(token);

    await tokenRef.set(
      {
        uid,
        token,
        timezone: safeTimezone,
        updatedAt: FieldValue.serverTimestamp()
      },
      {
        merge: true
      }
    );

    return res.json({
      ok: true,
      message: "Notification token registered."
    });

  } catch (error) {
    console.error("Register token error:", error);

    return res.status(500).json({
      error: "Could not register notification token."
    });
  }
});

/* =========================
   SEND REMINDERS
========================= */

app.post("/api/send-reminders", async (req, res) => {
  try {
    const cronSecret = process.env.CRON_SECRET;

    const providedSecret =
      req.headers["x-cron-secret"];

    if (!cronSecret) {
      return res.status(500).json({
        error: "CRON_SECRET is not configured."
      });
    }

    if (providedSecret !== cronSecret) {
      return res.status(401).json({
        error: "Unauthorized."
      });
    }

    if (!firebaseReady || !db || !messaging) {
      return res.status(503).json({
        error: "Firebase is not configured."
      });
    }

    const now = new Date();

    const tokenSnapshot = await db
      .collection("notificationTokens")
      .get();

    let checkedTokens = 0;
    let notificationsSent = 0;
    let notificationsFailed = 0;

    for (const tokenDoc of tokenSnapshot.docs) {
      checkedTokens++;

      const tokenData = tokenDoc.data();

      const uid = tokenData.uid;
      const token = tokenData.token;
      const timezone =
        tokenData.timezone || "Asia/Karachi";

      if (!uid || !token) {
        continue;
      }

      /* =========================
         USER LOCAL TIME
      ========================= */

      const localParts = new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }
      ).formatToParts(now);

      const parts = {};

      for (const part of localParts) {
        if (part.type !== "literal") {
          parts[part.type] = part.value;
        }
      }

      const localDate =
        `${parts.year}-${parts.month}-${parts.day}`;

      const localTime =
        `${parts.hour}:${parts.minute}`;

      /* =========================
         FIND USER TASKS
      ========================= */

      const tasksSnapshot = await db
        .collection("tasks")
        .where("uid", "==", uid)
        .get();

      for (const taskDoc of tasksSnapshot.docs) {
        const task = taskDoc.data();

        if (task.completed === true) {
          continue;
        }

        if (task.notificationSentAt) {
          continue;
        }

        if (!task.date || !task.time) {
          continue;
        }

        /*
          Task is due when:
          date is today AND time <= current local time
          OR date is before today.
        */

        const isDue =
          task.date < localDate ||
          (
            task.date === localDate &&
            task.time <= localTime
          );

        if (!isDue) {
          continue;
        }

        const title =
          task.title ||
          "You have a task due.";

        try {
          await messaging.send({
            token,

            notification: {
              title: "Life Admin AI",
              body: `Reminder: ${title}`
            },

            data: {
              taskId: taskDoc.id,
              title: title
            },

            webpush: {
              notification: {
                title: "Life Admin AI",
                body: `Reminder: ${title}`,
                requireInteraction: true
              }
            }
          });

          await taskDoc.ref.update({
            notificationSentAt:
              FieldValue.serverTimestamp()
          });

          notificationsSent++;

        } catch (sendError) {
          notificationsFailed++;

          console.error(
            "Notification send error:",
            sendError.message
          );

          const errorCode =
            sendError?.errorInfo?.code || "";

          /*
            Remove invalid/expired FCM tokens.
          */

          if (
            errorCode.includes("registration-token-not-registered") ||
            errorCode.includes("invalid-registration-token")
          ) {
            await tokenDoc.ref.delete();
          }
        }
      }
    }

    return res.json({
      ok: true,
      checkedTokens,
      notificationsSent,
      notificationsFailed,
      time: now.toISOString()
    });

  } catch (error) {
    console.error("Send reminders error:", error);

    return res.status(500).json({
      error: "Could not send reminders."
    });
  }
});

/* =========================
   WEBSITE FALLBACK
========================= */

app.use((req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `Life Admin AI server running on port ${PORT}`
    );
  });
}

module.exports = app;