require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/ai", async (req, res) => {
  try {
    const { message, tasks } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        type: "input_error",
        error: "Message is required."
      });
    }

    const API_KEY = process.env.OPENROUTER_API_KEY;

    console.log("OpenRouter key loaded:", !!API_KEY);

    if (!API_KEY) {
      return res.status(500).json({
        type: "setup_error",
        error: "OpenRouter API key is not configured."
      });
    }

    const prompt = `
You are Life Admin AI.

You manage the user's tasks.

Current tasks:
${JSON.stringify(tasks || [])}

User message:
${message}

Today's date is ${new Date().toISOString().split("T")[0]}.

Reply in the same language as the user's message.

Return ONLY valid JSON.
Do not use markdown.
Do not use code fences.

========================
ADD TASK
========================

If the user clearly wants to add, create, or set a task:

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

If the user wants to change, edit, or update an existing task:

Find the closest matching task.

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

If the user clearly wants to delete or remove a task:

Find the matching task.

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

If the user is not adding, editing, or deleting a task:

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

    console.log("🤖 Sending request to OpenRouter...");

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`,
          "HTTP-Referer": "https://lifeadminai.onrender.com",
          "X-Title": "LifeAdminAI"
        },

        body: JSON.stringify({
          model: "openrouter/free",

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
      console.error("======================================");
      console.error("❌ OPENROUTER API ERROR");
      console.error("Status:", response.status);
      console.error(
        "Response:",
        JSON.stringify(data, null, 2)
      );
      console.error("======================================");

      if (response.status === 429) {
        return res.status(429).json({
          type: "quota",
          message:
            "AI temporarily unavailable hai. OpenRouter rate limit hit ho sakti hai.",
          retryAfter: 30
        });
      }

      return res.status(response.status).json({
        type: "ai_error",
        error:
          data?.error?.message ||
          "OpenRouter request failed."
      });
    }

    let rawReply =
      data?.choices?.[0]?.message?.content || "";

    if (!rawReply) {
      console.error(
        "❌ OpenRouter returned an empty response."
      );

      return res.status(500).json({
        type: "empty_response",
        error: "OpenRouter ne empty response diya."
      });
    }

    rawReply = rawReply
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    console.log("✅ OpenRouter response received.");

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

    return res.json({
      action: result.action || "none",

      task: result.task || null,

      taskIndex:
        typeof result.taskIndex === "number"
          ? result.taskIndex
          : null,

      reply:
        result.reply || "Done."
    });

  } catch (error) {
    console.error("======================================");
    console.error("❌ SERVER ERROR");
    console.error(error);
    console.error("======================================");

    return res.status(500).json({
      type: "server_error",
      error:
        "Server se connection mein problem aa gayi."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log("        LIFE ADMIN AI");
  console.log("======================================");
  console.log(`Server running on port ${PORT}`);
  console.log("======================================");
});
