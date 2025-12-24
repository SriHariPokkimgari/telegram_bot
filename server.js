import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import db from "./services/db.js";

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_API_KEY);

// Initialize database connection
async function initializeBot() {
  console.log(`Starting cricket pridiction Bot...`);

  const isConnected = await db.testConnection();

  if (!isConnected) {
    console.error("❌ Cannot start bot: Database connection failed");
    process.exit(1);
  }

  console.log("✅ Database connected successfully");

  // === BOT COMMANDS ===

  // Start command
  bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || "no username";
    const firstName = ctx.from.first_name;
    const lastName = ctx.from.last_name || "";

    try {
      const userResults = await db.query(
        `
        SELECT * FROM users WHERE user_id = $1
      `,
        [userId]
      );

      if (userResults.rows.length === 0) {
        //Register new user
        await db.query(
          `
          INSERT INTO users (user_id, username, first_name, last_name, coins)
          VALUES ($1, $2, $3, $4, $5);  
        `,
          [
            userId,
            userName,
            firstName,
            lastName,
            process.env.INITIAL_COINS || 1000,
          ]
        );

        await ctx.reply(`🏏 Welcome to Cricket Prediction Game, ${firstName}!
        
        🎉 You've been registered!
        💰 Starting coins: ${process.env.INITIAL_COINS || 1000}

        📋 Available commands:
        /coins - Check your balance
        /profile - View your profile
        /help - Show all commands

        No real money involved – only virtual game coins!`);
      } else {
        // Update last active
        await db.query(
          `
          UPDATE users SET last_active = CURRENT_TIMESTAMP
          WHERE user_id = $1  
        `,
          [userId]
        );

        const user = userResults.rows[0];
        await ctx.reply(`👋 Welcome back, ${firstName}!

          💰 Your coins: ${user.coins}
          📅 Joined: ${new Date(user.join_date).toLocaleDateString()}

          Type /help to see available commands.`);
      }
    } catch (error) {
      console.error(`Error in /start: ${error}`);
      ctx.reply(`Sorry, there was an error. Plese try again.`);
    }
  });

  // Coins command
  bot.command("coins", async (ctx) => {
    try {
      const result = await db.query(
        `
        SELECT coins FROM users 
        WHERE user_id = $1;  
      `,
        [ctx.from.id]
      );

      if (result.rows.length > 0) {
        ctx.reply(`💰 your current balance: ${result.rows[0].coins} coins`);
      } else {
        ctx.reply(`Please use /start to register first.`);
      }
    } catch (err) {
      console.error(`Error in / coins : ${err}`);
      ctx.reply("Error checking your coins.");
    }
  });

  // Profile command
  bot.command("profile", async (ctx) => {
    try {
      const result = await db.query(
        `
        SELECT * FROM users 
        WHERE user_id = $1  
      `,
        [ctx.from.id]
      );

      if (result.rows.length > 0) {
        const user = result.rows[0];
        ctx.reply(`👤 **Your Profile**
        
🆔 ID: ${user.user_id}
👤 Name: ${user.first_name} ${user.last_name || ""}
📛 Username: @${user.username || "Not set"}
💰 Coins: ${user.coins}
📅 Joined: ${new Date(user.join_date).toLocaleDateString()}
🕒 Last Active: ${new Date(user.last_active).toLocaleString()}`);
      } else {
        ctx.reply("Please use /start to register first.");
      }
    } catch (error) {
      console.error("Error in /profile:", error);
      ctx.reply("Error fetching your profile.");
    }
  });

  // Help command
  bot.command("help", (ctx) => {
    ctx.reply(`📚 **Cricket Prediction Bot - Commands**

👤 User Commands:
/start - Register/Start game
/coins - Check your coins
/profile - View your profile
/myid - Get your Telegram ID

🎮 Game Commands:
(Coming soon...)

🛠️ Admin Commands:
(Coming soon...)

⚙️ Settings:
/help - Show this message

💰 Starting coins: ${process.env.INITIAL_COINS || 1000}`);
  });

  // My ID command
  bot.command("myid", async (ctx) => {
    ctx.reply(
      `Your Telegram ID: \`${ctx.from.id}\`
    
Save this ID for admin features.`,
      { parse_mode: "Markdown" }
    );
  });
}

// === LAUNCH BOT ===

bot.launch().then(() => {
  console.log("🏏 Cricket Prediction Bot is running...");
  console.log("📊 Database: Connected");
  console.log("🤖 Bot: Ready");
});

//Start everything
initializeBot().catch(console.error);

// Greaceful shutdown
process.once("SIGINT", () => {
  console.log("\n🛑 Shutting down bot...");
  bot.stop("SIGINT");
  db.pool.end();
  process.exit(0);
});

process.once("SIGTERM", () => {
  console.log("\n🛑 Shutting down bot...");
  bot.stop("SIGTERM");
  db.pool.end();
  process.exit(0);
});
