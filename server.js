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
  const serviceAccountRaw =
    process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccountRaw) {
    let serviceAccount;

    try {
      serviceAccount =
        JSON.parse(serviceAccountRaw);
    } catch (error) {
      console.error(
        "FIREBASE_SERVICE_ACCOUNT JSON is invalid."
      );
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
    console.log(
      "FIREBASE_SERVICE_ACCOUNT is missing."
    );
  }
} catch (error) {
  console.error(
    "Firebase initialization error:",
    error.message
  );
}

/* =========================
   STATIC WEBSITE
========================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

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
    const {
      message,
      tasks = []
    } = req.body;

    if (
      !message ||
      typeof message !== "string"
    ) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    const apiKey =
      process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "AI service is not configured."
      });
    }

    /* =========================
       CURRENT DATE
    ========================= */

    const currentDate =
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Karachi",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());

    /* =========================
       EXISTING TASKS
    ========================= */

    const safeTasks =
      Array.isArray(tasks)
        ? tasks.map((task, index) => ({
            index,
            text: task?.text || "",
            date: task?.date || null,
            time: task?.time || null,
            completed:
              task?.completed === true
          }))
        : [];

    /* =========================
       AI INSTRUCTIONS
    ========================= */

    const systemPrompt = `
You are Life Admin AI.

You are a personal task and reminder assistant.

Understand English, Urdu, Roman Urdu,
and mixed language.

Return ONE valid JSON object only.

CURRENT DATE:
${currentDate}

EXISTING TASKS:
${JSON.stringify(safeTasks)}

DATE RULES:
- "today" means the current date.
- "tomorrow" means the next calendar day.
- "aaj" means today.
- "kal" usually means tomorrow when creating a task.
- "next week" means the appropriate future date.
- "subah" means morning.
- "dopahar" means afternoon.
- "shaam" means evening.
- "raat" means night.
- Convert dates to YYYY-MM-DD.
- Convert times to HH:MM 24-hour format.
- Do not invent a date or time unless clearly implied.

TASK CREATION:

If the user wants to create, add, schedule,
or be reminded about a task, return:

{
  "action": "add_task",
  "task": {
    "text": "short clear task title",
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null",
    "completed": false
  },
  "reply": "Task added."
}

Example:

User:
Add task: Call brother tomorrow at 10 AM

Return an add_task object with:
text = "Call brother"
time = "10:00"
date = tomorrow's date.

IMPORTANT:
For task creation:
- ALWAYS use action "add_task".
- ALWAYS include the task object.
- NEVER return only "Done".
- NEVER return "chat".
- NEVER return a safety classification.

TASK DELETION:

If the user wants to delete or remove a task:

1. Look through EXISTING TASKS.
2. Find the closest matching task.
3. Return its numeric index.

Return:

{
  "action": "delete_task",
  "taskIndex": 0,
  "reply": "Task deleted."
}

If no matching task exists:

{
  "action": "chat",
  "reply": "I couldn't find that task."
}

TASK EDITING:

If the user wants to edit, change,
or update an existing task:

1. Find the matching task.
2. Return its numeric index.
3. Return the complete updated task.

Return:

{
  "action": "edit_task",
  "taskIndex": 0,
  "task": {
    "text": "updated task title",
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null",
    "completed": false
  },
  "reply": "Task updated."
}

SHOW TASKS:

If the user asks to show or list tasks:

{
  "action": "show_tasks",
  "reply": "Here are your tasks."
}

NORMAL CHAT:

For greetings or general conversation:

{
  "action": "chat",
  "reply": "helpful natural response"
}

CRITICAL RULES:

- Return valid JSON ONLY.
- Return exactly ONE JSON object.
- Never use Markdown.
- Never use code fences.
- Never add explanations outside JSON.
- Never return "User Safety".
- Never return "safe".
- Never return "unsafe".
- Never use another action name.
- Keep task titles short and natural.
`;

    /* =========================
       OPENROUTER REQUEST
    ========================= */

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer":
            "https://life-admin-ai-gamma.vercel.app",
          "X-Title": "Life Admin AI"
        },

        body: JSON.stringify({
          model: "openrouter/free",

          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: message
            }
          ],

          temperature: 0.1
        })
      }
    );

    /* =========================
       OPENROUTER RESPONSE
    ========================= */

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        "OpenRouter error:",
        data
      );

      const errorMessage =
        data?.error?.message ||
        data?.error?.metadata?.raw ||
        "";

      const isQuotaError =
        response.status === 429 ||
        errorMessage.toLowerCase().includes("quota") ||
        errorMessage.toLowerCase().includes("rate limit") ||
        errorMessage.toLowerCase().includes("too many requests");

      if (isQuotaError) {
        return res.status(429).json({
          error: "AI usage limit reached.",
          upgradeUrl: "/upgrade"
        });
      }

      return res.status(response.status).json({
        error:
          "AI service is temporarily unavailable."
      });
    }

    const text =
      data?.choices?.[0]?.message?.content ||
      "";

    console.log(
      "AI raw response:",
      text
    );

    if (!text) {
      return res.status(500).json({
        error:
          "AI returned an empty response."
      });
    }

    /* =========================
       PARSE JSON
    ========================= */

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const cleaned =
        text
          .replace(/```json/gi, "")
          .replace(/```/g, "")
          .trim();

      try {
        parsed = JSON.parse(cleaned);
      } catch (error2) {
        console.error(
          "AI returned invalid JSON:",
          text
        );

        return res.status(500).json({
          error:
            "AI returned an invalid response."
        });
      }
    }

    /* =========================
       VALID ACTIONS
    ========================= */

    const allowedActions = [
      "add_task",
      "edit_task",
      "delete_task",
      "show_tasks",
      "chat"
    ];

    if (
      !allowedActions.includes(
        parsed.action
      )
    ) {
      return res.status(500).json({
        error:
          "AI returned an unsupported action."
      });
    }

    /* =========================
       ADD TASK
    ========================= */

    if (
      parsed.action === "add_task"
    ) {
      if (
        !parsed.task ||
        typeof parsed.task !== "object" ||
        !parsed.task.text
      ) {
        return res.status(500).json({
          error:
            "AI did not return a valid task."
        });
      }

      return res.json({
        action: "add_task",

        task: {
          text: String(
            parsed.task.text
          ),
          date:
            parsed.task.date || null,
          time:
            parsed.task.time || null,
          completed: false
        },

        reply:
          parsed.reply ||
          "Task added."
      });
    }

    /* =========================
       DELETE TASK
    ========================= */

    if (
      parsed.action === "delete_task"
    ) {
      const taskIndex =
        Number(parsed.taskIndex);

      if (
        !Number.isInteger(taskIndex) ||
        taskIndex < 0 ||
        taskIndex >= safeTasks.length
      ) {
        return res.json({
          action: "chat",
          reply:
            "I couldn't find that task."
        });
      }

      return res.json({
        action: "delete_task",
        taskIndex,
        reply:
          parsed.reply ||
          "Task deleted."
      });
    }

    /* =========================
       EDIT TASK
    ========================= */

    if (
      parsed.action === "edit_task"
    ) {
      const taskIndex =
        Number(parsed.taskIndex);

      if (
        !Number.isInteger(taskIndex) ||
        taskIndex < 0 ||
        taskIndex >= safeTasks.length
      ) {
        return res.json({
          action: "chat",
          reply:
            "I couldn't find that task to edit."
        });
      }

      if (
        !parsed.task ||
        typeof parsed.task !== "object" ||
        !parsed.task.text
      ) {
        return res.json({
          action: "chat",
          reply:
            "I couldn't understand the updated task."
        });
      }

      return res.json({
        action: "edit_task",

        taskIndex,

        task: {
          text: String(
            parsed.task.text
          ),
          date:
            parsed.task.date || null,
          time:
            parsed.task.time || null,
          completed: false
        },

        reply:
          parsed.reply ||
          "Task updated."
      });
    }

    /* =========================
       SHOW TASKS
    ========================= */

    if (
      parsed.action === "show_tasks"
    ) {
      return res.json({
        action: "show_tasks",
        reply:
          parsed.reply ||
          "Here are your tasks."
      });
    }

    /* =========================
       NORMAL CHAT
    ========================= */

    return res.json({
      action: "chat",
      reply:
        parsed.reply ||
        "How can I help?"
    });

  } catch (error) {
    console.error(
      "AI API error:",
      error
    );

    return res.status(500).json({
      error:
        "Something went wrong with the AI."
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
      typeof timezone === "string" &&
      timezone.length <= 100
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
        updatedAt:
          FieldValue.serverTimestamp()
      },
      {
        merge: true
      }
    );

    return res.json({
      ok: true,
      message:
        "Notification token registered."
    });

  } catch (error) {
    console.error(
      "Register token error:",
      error
    );

    return res.status(500).json({
      error:
        "Could not register notification token."
    });
  }
});

/* =========================
   SEND REMINDERS
========================= */

app.post("/api/send-reminders", async (req, res) => {
  try {
    const cronSecret =
      process.env.CRON_SECRET;

    const providedSecret =
      req.headers["x-cron-secret"];

    if (!cronSecret) {
      return res.status(500).json({
        error:
          "CRON_SECRET is not configured."
      });
    }

    if (providedSecret !== cronSecret) {
      return res.status(401).json({
        error: "Unauthorized."
      });
    }

    if (
      !firebaseReady ||
      !db ||
      !messaging
    ) {
      return res.status(503).json({
        error:
          "Firebase is not configured."
      });
    }

    const now = new Date();

    const tokenSnapshot =
      await db
        .collection("notificationTokens")
        .get();

    let checkedTokens = 0;
    let notificationsSent = 0;
    let notificationsFailed = 0;

    for (
      const tokenDoc of tokenSnapshot.docs
    ) {
      checkedTokens++;

      const tokenData =
        tokenDoc.data();

      const uid = tokenData.uid;
      const token = tokenData.token;

      const timezone =
        tokenData.timezone ||
        "Asia/Karachi";

      if (!uid || !token) {
        continue;
      }

      /* =========================
         USER LOCAL TIME
      ========================= */

      const localParts =
        new Intl.DateTimeFormat(
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

      for (
        const part of localParts
      ) {
        if (
          part.type !== "literal"
        ) {
          parts[part.type] =
            part.value;
        }
      }

      const localDate =
        `${parts.year}-${parts.month}-${parts.day}`;

      const localTime =
        `${parts.hour}:${parts.minute}`;

      /* =========================
         FIND USER
      ========================= */

      const userRef =
        db
          .collection("users")
          .doc(uid);

      const userDoc =
        await userRef.get();

      if (!userDoc.exists) {
        continue;
      }

      const userData =
        userDoc.data() || {};

      /*
        IMPORTANT:

        app.html saves tasks inside:

        users/{uid}.tasks

        So the reminder system reads
        the same task location.
      */

      const userTasks =
        Array.isArray(userData.tasks)
          ? userData.tasks
          : [];

      let tasksChanged = false;

      /* =========================
         CHECK USER TASKS
      ========================= */

      for (
        let taskIndex = 0;
        taskIndex < userTasks.length;
        taskIndex++
      ) {
        const task =
          userTasks[taskIndex];

        if (
          !task ||
          task.completed === true
        ) {
          continue;
        }

        if (
          task.notificationSentAt
        ) {
          continue;
        }

        if (
          !task.date ||
          !task.time
        ) {
          continue;
        }

        /* =========================
           CHECK IF TASK IS DUE
        ========================= */

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
          task.text ||
          "You have a task due.";

        /* =========================
           SEND NOTIFICATION
        ========================= */

        try {
          await messaging.send({
            token,

            notification: {
              title:
                "Life Admin AI",

              body:
                `Reminder: ${title}`
            },

            data: {
              taskId:
                String(
                  task.id ||
                  taskIndex
                ),

              title:
                String(title)
            },

            webpush: {
              notification: {
                title:
                  "Life Admin AI",

                body:
                  `Reminder: ${title}`,

                requireInteraction:
                  true
              }
            }
          });

          /* =========================
             MARK AS SENT
          ========================= */

          userTasks[taskIndex] = {
            ...task,

            notificationSentAt:
              new Date().toISOString()
          };

          tasksChanged = true;

          notificationsSent++;

        } catch (sendError) {
          notificationsFailed++;

          console.error(
            "Notification send error:",
            sendError.message
          );

          const errorCode =
            sendError?.errorInfo?.code ||
            "";

          if (
            errorCode.includes(
              "registration-token-not-registered"
            ) ||
            errorCode.includes(
              "invalid-registration-token"
            )
          ) {
            await tokenDoc.ref.delete();
          }
        }
      }

      /* =========================
         SAVE UPDATED TASKS
      ========================= */

      if (tasksChanged) {
        await userRef.set(
          {
            tasks: userTasks,

            updatedAt:
              FieldValue.serverTimestamp()
          },
          {
            merge: true
          }
        );
      }
    }

    /* =========================
       RESPONSE
    ========================= */

    return res.json({
      ok: true,

      checkedTokens,

      notificationsSent,

      notificationsFailed,

      time:
        now.toISOString()
    });

  } catch (error) {
    console.error(
      "Send reminders error:",
      error
    );

    return res.status(500).json({
      error:
        "Could not send reminders."
    });
  }
});

/* =========================
   WEBSITE FALLBACK
========================= */

app.use((req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================
   START SERVER
========================= */

const PORT =
  process.env.PORT || 3000;

if (require.main === module) {
  app.listen(
    PORT,
    () => {
      console.log(
        `Life Admin AI server running on port ${PORT}`
      );
    }
  );
}

module.exports = app;