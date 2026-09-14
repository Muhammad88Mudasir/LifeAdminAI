require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// AI API
// ==========================================

app.post("/api/ai", async (req, res) => {
  try {
    const { message, tasks } = req.body;

    // ------------------------------------------
    // CHECK MESSAGE
    // ------------------------------------------

    if (!message || !message.trim()) {
      return res.status(400).json({
        type: "input_error",
        error: "Message is required."
      });
    }

    // ------------------------------------------
    // OPENROUTER API KEY
    // ------------------------------------------

    const API_KEY = process.env.OPENROUTER_API_KEY;

    console.log("OpenRouter key loaded:", !!API_KEY);

    if (!API_KEY) {
      console.error("❌ OPENROUTER_API_KEY is missing.");

      return res.status(500).json({
        type: "setup_error",
        error: "OpenRouter API key is not configured."
      });
    }

    // ------------------------------------------
    // AI PROMPT
    // ------------------------------------------

    const prompt = `
You are Life Admin AI.

You manage the user's tasks.

Current tasks:
${JSON.stringify(tasks || [])}

User message:
${message}

Today's date is ${new Date().toISOString().split("T")[0]}.

IMPORTANT: Reply in the same language as the user's message.
If the user writes English, the reply must be in English.
If the user writes Hindi, Urdu, Punjabi, or any other language, reply in that same language.
Keep the JSON structure unchanged.

ADD TASK
========================

If the user clearly wants to add/create/set a task:

{
  "action": "add_task",
  "task": {
    "text": "short clear task",
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null"
  },
  "taskIndex": null,
  "reply": "short natural confirmation"
}

========================
EDIT TASK
========================

If the user wants to change/edit/update an existing task:

Find the closest matching task.

Return:

{
  "action": "edit_task",
  "task": {
    "text": "updated task text",
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null"
  },
  "taskIndex": 0,
  "reply": "short natural confirmation"
}

taskIndex MUST be the exact index of the existing task.

========================
DELETE TASK
========================

If the user clearly wants to delete/remove a task:

Find the matching task.

Return:

{
  "action": "delete_task",
  "task": null,
  "taskIndex": 0,
  "reply": "short natural confirmation"
}

taskIndex MUST be the exact index of the task.

========================
NORMAL QUESTION
========================

If the user is not adding, editing or deleting a task:

{
  "action": "none",
  "task": null,
  "taskIndex": null,
  "reply": "short natural answer"
}

Understand:

today
tomorrow
kal
aaj
subah
dopahar
shaam
raat

If no exact date or time is given, use null.

IMPORTANT:

Only use add_task when the user clearly wants to create a task.

Only use edit_task when the user clearly wants to modify an existing task.

Only use delete_task when the user clearly wants to remove a task.
`;

    // ==========================================
    // OPENROUTER REQUEST
    // ==========================================

    console.log("🤖 Sending request to OpenRouter...");

    const model =
      process.env.OPENROUTER_MODEL ||
      "nex-agi/nex-n2.5-mini:free";

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "LifeAdminAI"
        },

        body: JSON.stringify({
          model,
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

    // ==========================================
    // OPENROUTER ERROR
    // ==========================================

    if (!response.ok) {
      console.error("");
      console.error("======================================");
      console.error("❌ OPENROUTER API ERROR");
      console.error("Status:", response.status);
      console.error("Response:", JSON.stringify(data, null, 2));
      console.error("======================================");
      console.error("");

      if (response.status === 429) {
        return res.status(429).json({
          type: "quota",
          message:
            "AI temporarily unavailable hai. OpenRouter rate limit / free model limit ho sakti hai.",
          retryAfter: 30
        });
      }

      return res.status(response.status).json({
        type: "ai_error",
        error:
          data?.error?.message ||
          "OpenRouter request failed. Please check your API key, model, or account limits."
      });
    }

    // ==========================================
    // GET AI RESPONSE
    // ==========================================

    let rawReply = "";

    rawReply =
      data?.choices?.[0]?.message?.content || "";

    // ==========================================
    // EMPTY RESPONSE
    // ==========================================

    if (!rawReply) {
      console.error("❌ OpenRouter returned an empty response.");
      console.error(JSON.stringify(data, null, 2));

      return res.status(500).json({
        type: "empty_response",
        error: "OpenRouter ne empty response diya."
      });
    }

    // ==========================================
    // CLEAN RESPONSE
    // ==========================================

    rawReply = rawReply
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    console.log("✅ OpenRouter response received.");

    // ==========================================
    // JSON PARSE
    // ==========================================

    let result;

    try {
      result = JSON.parse(rawReply);
    } catch (parseError) {
      console.error("❌ AI JSON Parse Error:");
      console.error(rawReply);

      return res.json({
        action: "none",
        task: null,
        taskIndex: null,
        reply: rawReply
      });
    }

    // ==========================================
    // SEND RESULT TO FRONTEND
    // ==========================================

    return res.json({
      action: result.action || "none",

      task: result.task || null,

      taskIndex:
        typeof result.taskIndex === "number"
          ? result.taskIndex
          : null,

      reply:
        result.reply ||
        "Done."
    });

  } catch (error) {

    // ==========================================
    // SERVER ERROR
    // ==========================================

    console.error("");
    console.error("======================================");
    console.error("❌ SERVER ERROR");
    console.error(error);
    console.error("======================================");
    console.error("");

    return res.status(500).json({
      type: "server_error",
      error:
        "Server se connection mein problem aa gayi."
    });
  }
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("======================================");
  console.log("        LIFE ADMIN AI");
  console.log("======================================");
  console.log(`PC: http://localhost:${PORT}`);
  console.log(`Port: ${PORT}`);
  console.log("======================================");
  console.log("");
});
