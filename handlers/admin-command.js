import db from "../services/db.js";
import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";

dotenv.config();

class AdminCommands {
  constructor(bot) {
    this.bot = bot;
    this.adminId = process.env.ADMIN_ID;
  }

  async isAdmin(userId) {
    return userId.toString() === this.adminId;
  }

  async startMatch(ctx, matchName = "Cricket T20 Match") {
    if (!(await this.isAdmin(ctx.from.id))) {
      return ctx.reply("❌ Admin only command.");
    }

    try {
      // End any existing live match
      await db.query(
        `UPDATE matches 
            SET status = 'completed,
            ended_at = CURRENT_TIMESTAMP
            WHERE status = 'live';`
      );

      // Start new match
      const result = await db.query(
        `INSERT INTO matches 
         (match_name, status, total_overs, team_a, team_b, started_at, current_over, current_ball)
         VALUES ($1, 'live', 20, 'Team A', 'Team B', CURRENT_TIMESTAMP, 0, 0)
         RETURNING match_id`,
        [matchName]
      );

      const matchId = result.rows[0].match_id;

      // Notify all users
      const users = await db.query(
        `SELECT user_id FROM users WHERE is_active = true`
      );

      for (const user of users.rows) {
        try {
          await this.bot.telegram.sendMessage(
            user.user_id,
            `🎉 *NEW MATCH STARTED!*\n\n🏏 *${matchName}* is now LIVE!\n\nClick /live to join the action!`,
            { parse_mode: "Markdown" }
          );
        } catch (error) {
          // User might have blocked the bot
          console.log(`Cannot notify user ${user.user_id}`);
        }
      }

      await ctx.reply(
        `✅ *Match Started!*\n\nMatch ID: ${matchId}\nName: ${matchName}\n\nPlayers are being notified.`,
        { parse_mode: "Markdown" }
      );

      return matchId;
    } catch (error) {
      console.error("Error starting match:", error);
      await ctx.reply("❌ Error starting match.");
    }
  }

  async stopMatch(ctx) {
    if (!(await this.isAdmin(ctx.from.id))) {
      return ctx.reply("❌ Admin only command.");
    }

    try {
      const result = await db.query(
        "UPDATE matches SET status = 'completed', ended_at = CURRENT_TIMESTAMP WHERE status = 'live' RETURNING match_id, match_name"
      );

      if (result.rows.length === 0) {
        return ctx.reply("❌ No active match found.");
      }

      const match = result.rows[0];

      await ctx.reply(
        `🛑 *Match Stopped!*\n\nMatch: ${match.match_name}\nID: ${match.match_id}\n\nFinal results will be calculated.`,
        { parse_mode: "Markdown" }
      );

      return match.match_id;
    } catch (error) {
      console.error("Error stopping match:", error);
      await ctx.reply("❌ Error stopping match.");
    }
  }

  async addCoins(ctx, targetUserId, amount) {
    if (!(await this.isAdmin(ctx.from.id))) {
      return ctx.reply("❌ Admin only command.");
    }

    try {
      // Validate amount
      const coins = parseInt(amount);
      if (isNaN(coins) || coins <= 0) {
        return ctx.reply(
          "❌ Invalid amount. Please provide a positive number."
        );
      }

      // Check if user exists
      const userCheck = await db.query(
        `SELECT username FROM users
            WHERE user_id = $1`,
        [targetUserId]
      );

      if (userCheck.rows.length === 0) {
        return ctx.reply("❌ User not found.");
      }

      // Add coins
      await db.query(
        `UPDATE users SET coins = coins + $1
            WHERE user_id = $2`,
        [coins, targetUserId]
      );

      // Record admin action
      await db.query(
        `INSERT INTO admin_actions (admin_id, action_type, target_user_id, amount, description)
            VALUES ($1, 'add_coins', $2, $3, $4)`,
        [ctx.from.id, targetUserId, coins, `Admin added ${coins} coins`]
      );

      // Get new balance
      const newBalance = await db.query(
        `SELECT coins FROM users 
            WHERE user_id = $1 `,
        [targetUserId]
      );

      await ctx.reply(
        `✅ *Coins Added!*\n\nUser: ${targetUserId}\nAdded: ${coins} coins\nNew Balance: ${newBalance.rows[0].coins} coins`,
        { parse_mode: "Markdown" }
      );

      // Notify user
      try {
        await this.bot.telegram.sendMessage(
          targetUserId,
          `🎉 *COINS ADDED!*\n\nAdmin added *${coins} coins* to your account!\n\nNew balance: *${newBalance.rows[0].coins} coins*`,
          { parse_mode: "Markdown" }
        );
      } catch (error) {
        console.log(`Cannot notify user ${targetUserId}`);
      }
    } catch (error) {
      console.error("Error adding coins:", error);
      await ctx.reply("❌ Error adding coins.");
    }
  }

  async resetCoins(ctx, targetUserId) {
    if (!(await this.isAdmin(ctx.from.id))) {
      return ctx.reply("❌ Admin only command.");
    }

    try {
      // Reset to initial coins
      const initialCoins = process.env.INITIAL_COINS || 1000;

      await db.query("UPDATE users SET coins = $1 WHERE user_id = $2", [
        initialCoins,
        targetUserId,
      ]);

      // Record admin action
      await db.query(
        `INSERT INTO admin_actions (admin_id, action_type, target_user_id, amount, description)
         VALUES ($1, 'reset_coins', $2, $3, $4)`,
        [
          ctx.from.id,
          targetUserId,
          initialCoins,
          `Admin reset coins to ${initialCoins}`,
        ]
      );

      await ctx.reply(
        `🔄 *Coins Reset!*\n\nUser: ${targetUserId}\nReset to: ${initialCoins} coins`,
        { parse_mode: "Markdown" }
      );

      // Notify user
      try {
        await this.bot.telegram.sendMessage(
          targetUserId,
          `🔄 *COINS RESET!*\n\nYour coins have been reset to *${initialCoins}* by admin.`,
          { parse_mode: "Markdown" }
        );
      } catch (error) {
        console.log(`Cannot notify user ${targetUserId}`);
      }
    } catch (error) {
      console.error("Error resetting coins:", error);
      await ctx.reply("❌ Error resetting coins.");
    }
  }

  async getUserHistory(ctx, targetUserId) {
    if (!(await this.isAdmin(ctx.from.id))) {
      return ctx.reply("❌ Admin only command.");
    }

    try {
      // Get user info
      const userInfo = await db.query(
        "SELECT username, coins, join_date FROM users WHERE user_id = $1",
        [targetUserId]
      );

      if (userInfo.rows.length === 0) {
        return ctx.reply("❌ User not found.");
      }

      const user = userInfo.rows[0];

      // Get prediction history
      const history = await db.query(
        `SELECT p.*, m.match_name
        FROM predictions p
        LEFT JOIN matches m ON p.match_id = m.match_id
        WHERE p.user_id = $1
        ORDERBY p.created_at DESC
        LIMIT 10`,
        [targetUserId]
      );

      let message = `📊 *USER HISTORY*\n\n`;
      message += `👤 User: ${user.username || "N/A"} (${targetUserId})\n`;
      message += `💰 Coins: ${user.coins}\n`;
      message += `📅 Joined: ${new Date(
        user.join_date
      ).toLocaleDateString()}\n\n`;

      if (history.rows.length === 0) {
        message += "No prediction history.";
      } else {
        message += "*RECENT PREDICTIONS:*\n\n";
        history.rows.forEach((pred, index) => {
          const result = pred.is_winner ? "✅" : "❌";
          message += `${index + 1}. ${result} ${pred.match_name || "Match"}\n`;
          message += `   Ball: ${pred.ball_number} | Prediction: ${pred.prediction_type}\n`;
          message += `   Result: ${pred.actual_result} | Bet: ${pred.coins_bet}\n`;
          message += `   Won: ${pred.coins_won} coins\n\n`;
        });
      }

      // Get stats
      const stats = await db.query(
        `SELECT COUNT(*) as total_predictions,
        SUM(CASE WHEN is_winner THEN 1 ELSE 0 END) as wins,
        SUM(coins_won) as total_won,
        sum(coins_bet) as total_bet
        FROM predictions
        WHERE user_id = $1`,
        [targetUserId]
      );

      if (stats.rows.length > 0) {
        const stat = stats.rows[0];
        const winRate =
          stat.total_predictions > 0
            ? ((stat.wins / stat.total_predictions) * 100).toFixed(1)
            : "0.0";

        message += `\n📈 *STATISTICS:*\n`;
        message += `Total Predictions: ${stat.total_predictions || 0}\n`;
        message += `Wins: ${stat.wins || 0} (${winRate}%)\n`;
        message += `Total Bet: ${stat.total_bet || 0} coins\n`;
        message += `Total Won: ${stat.total_won || 0} coins\n`;

        if (stat.total_bet > 0) {
          const roi = (
            ((stat.total_won - stat.total_bet) / stat.total_bet) *
            100
          ).toFixed(1);
          message += `ROI: ${roi}%`;
        }
      }

      await ctx.reply(message, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("Error getting user history:", error);
      await ctx.reply("❌ Error fetching user history.");
    }
  }

  async broadcastMessage(ctx, message) {
    if (!(await this.isAdmin(ctx.from.id))) {
      return ctx.reply("❌ Admin only command.");
    }

    try {
      const users = await db.query(
        "SELECT user_id FROM users WHERE is_active = true"
      );

      let successCount = 0;
      let failCount = 0;

      for (const user of users.rows) {
        try {
          await this.bot.telegram.sendMessage(
            user.user_id,
            `📢 *ADMIN BROADCAST*\n\n${message}`,
            { parse_mode: "Markdown" }
          );
          successCount++;
        } catch (error) {
          failCount++;
        }
      }

      await ctx.reply(
        `📢 *BROADCAST COMPLETE*\n\nSent to: ${successCount} users\nFailed: ${failCount} users`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      console.error("Error broadcasting:", error);
      await ctx.reply("❌ Error broadcasting message.");
    }
  }

  registerCommands() {
    // Admin command handler
    this.bot.command("admin", async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) {
        return ctx.reply("❌ Admin only command.");
      }

      await ctx.reply(`👑 *ADMIN PANEL*\n\nSelect an action:`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback("▶️ Start Match", "admin_start_match"),
              Markup.button.callback("⏹️ Stop Match", "admin_stop_match"),
            ],
            [
              Markup.button.callback("💰 Add Coins", "admin_add_coins"),
              Markup.button.callback("🔄 Reset Coins", "admin_reset_coins"),
            ],
            [
              Markup.button.callback("📊 User History", "admin_user_history"),
              Markup.button.callback("📢 Broadcast", "admin_broadcast"),
            ],
            [
              Markup.button.callback("📈 System Stats", "admin_system_stats"),
              Markup.button.callback("⚙️ Settings", "admin_settings"),
            ],
          ],
        },
      });
    });

    // Individual admin commands (for direct use)
    this.bot.command("startmatch", async (ctx) => {
      const args = ctx.message.text.split(" ");
      const matchName = args.slice(1).join(" ") || "Cricket T20 Match";
      await this.startMatch(ctx, matchName);
    });

    this.bot.command("stopmatch", async (ctx) => {
      await this.stopMatch(ctx);
    });

    this.bot.command("addcoins", async (ctx) => {
      const args = ctx.message.text.split(" ");
      if (args.length < 3) {
        return ctx.reply("Usage: /addcoins <user_id> <amount>");
      }
      await this.addCoins(ctx, args[1], args[2]);
    });

    this.bot.command("resetcoins", async (ctx) => {
      const args = ctx.message.text.split(" ");
      if (args.length < 2) {
        return ctx.reply("Usage: /resetcoins <user_id>");
      }
      await this.resetCoins(ctx, args[1]);
    });

    this.bot.command("userhistory", async (ctx) => {
      const args = ctx.message.text.split(" ");
      if (args.length < 2) {
        return ctx.reply("Usage: /userhistory <user_id>");
      }
      await this.getUserHistory(ctx, args[1]);
    });

    this.bot.command("broadcast", async (ctx) => {
      const message = ctx.message.text.split(" ").slice(1).join(" ");
      if (!message) {
        return ctx.reply("Usage: /broadcast <message>");
      }
      await this.broadcastMessage(ctx, message);
    });
  }
}

export default AdminCommands;
