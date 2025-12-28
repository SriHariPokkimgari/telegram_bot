import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
import db from "./services/db.js";
import LiveDashboard from "./handlers/live-dashboard.js";
dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_API_KEY);
const liveDashboard = new LiveDashboard(bot);

// Store active game sessions in memory (for demo)
const activeSessions = new Map(); // user_id -> {match_id, betAmount, lastPrediction}
const userDashboard = new Map();

// ===== Helper functions =====

async function getUserCoins(userId) {
  try {
    const result = await db.query(
      `
      SELECT coins FROM users
      WHERE user_id = $1
    `,
      [userId]
    );

    return result.rows.length > 0 ? result.rows[0].coins : 0;
  } catch (error) {
    console.error("Error getting user coins:", error);
    return 0;
  }
}

async function updateUserCoins(userId, amountChange) {
  try {
    await db.query(
      `
      UPDATE users
      SET coins = coins + $1
      WHERE user_id = $2
    `,
      [amountChange, userId]
    );

    const newCoins = await getUserCoins(userId);
    return newCoins;
  } catch (error) {
    console.error(`Error updating coins at "server": ${error}`);
    return 0;
  }
}

async function getActiveMatch() {
  try {
    const result = await db.query(`
      SELECT * FROM matches
      WHERE status = 'live'
      ORDER BY match_id DESC
      LIMIT 1
    `);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error(`Error getting active matches at "server" : ${error}`);
    return null;
  }
}

// ========== INITIALIZE BOT ==========

async function initializeBot() {
  console.log("🤖 Starting Cricket Prediction Bot with Live Dashboard...");

  const isConnected = await db.testConnection();

  if (!isConnected) {
    console.error("❌ Cannot start bot: Database connection failed");
    process.exit(1);
  }

  console.log("✅ Database connected successfully");

  // ===== Start command =====
  bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || "no username";
    const firstName = ctx.from.first_name;
    const lastName = ctx.from.last_name || "";
    const chatId = ctx.chat.id;

    try {
      // Check if user exists
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

        await liveDashboard.sendNotification(
          userId,
          "welcome",
          `Welcom ${firstName}! You received ${
            process.env.INITIAL_COINS || 1000
          } starting coins.`
        );

        // 🎉 You've been registered!
        // 💰 Starting coins: ${process.env.INITIAL_COINS || 1000}

        // Click /join to start playing!`);
      } else {
        // Update last active
        await db.query(
          `
            UPDATE users SET last_active = CURRENT_TIMESTAMP
            WHERE user_id = $1
          `,
          [userId]
        );
      }

      // Send welcome message
      await ctx.reply(
        `🏏 *Welcome to Cricket Prediction Game!*

  🎮 *Real-time cricket predictions*
  💰 *Virtual coins, real excitement*
  📊 *Live dashboard updates*
  🔔 *Instant notifications*

  *Ready to experience live cricket action?*`,
        { parse_mode: "Markdown" }
      );

      // Show main menu
      await showMainMenu(ctx);
    } catch (error) {
      console.error(`Error in /start: ${error}`);
      ctx.reply(`Sorry, there was an error. Plese try again.`);
    }
  });

  // ===== Live dashboard command =====
  bot.command("live", async (ctx) => {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    try {
      const activeMatch = await getActiveMatch();

      if (!activeMatch) {
        await ctx.reply(
          "No live match at the moment. A match will start soon!\n\nUse /startmatch as admin to begin.",
          Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Check Again", "check_match_status")],
            [Markup.button.callback("🏠 Main Menu", "main_menu")],
          ])
        );
        return;
      }

      // Subscribe to live update
      await liveDashboard.subscribeToMatch(
        userId,
        chatId,
        activeMatch.match_id
      );

      // Send live dashboard
      await liveDashboard.sendLiveDashboard(
        userId,
        chatId,
        activeMatch.match_id
      );
    } catch (error) {
      console.error("Error in /live:", error);
      ctx.reply("Error loading live dashboard. Please try again.");
    }
  });

  // ===== Private dashboard command =====
  bot.command("dashboard", async (ctx) => {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    try {
      await liveDashboard.sendPrivateDashboard(userId, chatId);
    } catch (error) {
      console.error("Error in /dashboard:", error);
      ctx.reply("Error loading private dashboard.");
    }
  });

  // ===== Join match with live updates =====
  bot.action("join_live_match", async (ctx) => {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    try {
      const userCoins = await getUserCoins(userId);

      if (userCoins < 10) {
        await ctx.reply(
          `❌ *INSUFFICIENT COINS*

  You need at least *10 coins* to join a match.
  Current balance: *${userCoins} coins*

  *Options:*
  1. Wait for daily bonus
  2. Contact admin for coins
  3. Watch match without playing`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [Markup.button.callback("👀 Watch Match Only", "watch_only")],
                [Markup.button.callback("💰 Check Balance", "check_balance")],
                [Markup.button.callback("🏠 Main Menu", "main_menu")],
              ],
            },
          }
        );
        return;
      }

      const activeMatch = await getActiveMatch();

      if (!activeMatch) {
        await ctx.editMessageText(
          `⏳ *NO ACTIVE MATCH*

  There is no live match at the moment.
  A new match will start soon!

  *What would you like to do?*`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  Markup.button.callback(
                    "🔄 Check Again",
                    "check_match_status"
                  ),
                ],
                [
                  Markup.button.callback(
                    "📱 Private Dashboard",
                    "private_dashboard"
                  ),
                ],
                [Markup.button.callback("🏠 Main Menu", "main_menu")],
              ],
            },
          }
        );
        return;
      }

      // Store user session
      activeSessions.set(userId, {
        matchId: activeMatch.match_id,
        betAmount: 10,
        lastPrediction: null,
        joinAt: new Date(),
      });

      // Subscribe to live updates
      await liveDashboard.subscribeToMatch(
        userId,
        chatId,
        activeMatch.match_id
      );

      // Send success message
      await ctx.editMessageText(
        `✅ *SUCCESSFULLY JOINED!*

  🎮 *Match:* ${activeMatch.match_name}
  💰 *Your Coins:* ${userCoins}
  👥 *Players Online:* Checking...

  *You will receive:*
  🎯 Live ball-by-ball updates
  📊 Real-time scoreboard
  🔔 Prediction results
  🏆 Leaderboard updates

  *Getting live dashboard ready...*`,
        { parse_mode: "Markdown" }
      );

      // Send live dashboard after a delay
      setTimeout(async () => {
        await liveDashboard.sendLiveDashboard(
          userId,
          chatId,
          activeMatch.match_id
        );
      }, 1000);
    } catch (error) {
      console.error("Error joining match:", error);
      await ctx.answerCbQuery("Error joining match. Please try again.");
    }
  });

  // ===== Live dashboard button handlers
  bot.action("refresh_dashboard", async (ctx) => {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    try {
      const session = activeSessions.get(userId);
      if (!session) {
        await ctx.answerCbQuery("Please join a match first!");
        return;
      }

      await ctx.answerCbQuery("🔄 Refreshing dashboard...");
      await liveDashboard.sendLiveDashboard(userId, chatId, session.matchId);
    } catch (error) {
      console.error("Error refreshing dashboard:", error);
      await ctx.answerCbQuery("Error refreshing. Please try again.");
    }
  });

  // ===== JOIN COMMAND =====
  bot.command("join", async (ctx) => {
    const userId = ctx.from.id;

    try {
      const userCoins = await getUserCoins(userId);

      if (userCoins < 10) {
        await ctx.reply(`❌ You need at least 10 coins to play!
             Current coins: ${userCoins}

             Use /coins to check your balance.`);
        return;
      }

      const activeMatch = await getActiveMatch();

      if (!activeMatch) {
        // No active match, show start match button (admin will handle)
        await ctx.reply(
          "No active match found. A new match will start soon!",
          Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Check Again", "check_match")],
          ])
        );
        return;
      }

      // Store user session
      activeSessions.set(userId, {
        matchId: activeMatch.match_id,
        betAmount: 10, //Default bet
        lastPrediction: null,
      });

      await ctx.reply(
        `🎮 JOINED MATCH!

  🏏 Match: ${activeMatch.match_name}
  🎯 Current: Over ${activeMatch.current_over}.${activeMatch.current_ball}
  📊 Score: ${activeMatch.team_a_score}/${activeMatch.wickets}
  💰 Your coins: ${userCoins}

  Place your prediction for the next ball!`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback("2 Runs (1.5x)", "predict_2_runs"),
            Markup.button.callback("4 Runs (2x)", "predict_4_runs"),
          ],
          [
            Markup.button.callback("6 Runs (3x)", "predict_6_runs"),
            Markup.button.callback("Wicket (5x)", "predict_wicket"),
          ],
          [
            Markup.button.callback("Dot Ball (1.8x)", "predict_dot_ball"),
            Markup.button.callback("💰 Bet: 10", "bet_10"),
          ],
          [
            Markup.button.callback("🔄 Refresh", "refresh_dashboard"),
            Markup.button.callback("📊 My Stats", "my_stats"),
          ],
        ])
      );
    } catch (error) {
      console.error("Error in /join:", error);
      ctx.reply("Error joining match. Please try again.");
    }
  });

  // ===== PREDICTION BUTTONS HANDLERS =====

  // Handle prediction selection
  bot.action(/predict_(.+)/, async (ctx) => {
    const userId = ctx.from.id;
    const predictionType = ctx.match[1];

    const session = activeSessions.get(userId);
    if (!session) {
      await ctx.answerCbQuery("Please join a match first using /join");
      return;
    }

    const userCoins = await getUserCoins(userId);

    if (userCoins < session.betAmount) {
      await ctx.answerCbQuery(
        `Not enough coins! Need ${session.betAmount}, have ${userCoins}`
      );
      return;
    }

    // Store prediction
    session.lastPrediction = predictionType;

    const predictionData = gameLogic.predictionTypes[predictionType];

    await ctx.answerCbQuery(
      `Selected: ${predictionData.label} (Bet: ${session.betAmount} coins)`
    );

    // Show confirmation
    await ctx.editMessageText(
      `✅ PREDICTION CONFIRMED!

  🎯 You predicted: ${predictionData.label}
  💰 Bet amount: ${session.betAmount} coins
  🎲 Multiplier: ${predictionData.multiplier}x
  💰 Potential win: ${session.betAmount * predictionData.multiplier} coins

  Waiting for ball result...`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🚀 SIMULATE BALL", "simulate_ball")],
        [Markup.button.callback("↩️ Change Prediction", "change_prediction")],
      ])
    );
  });

  // Handle bet amount selection
  bot.action(/bet_(\d+)/, async (ctx) => {
    const userId = ctx.from.id;
    const betAmount = parseInt(ctx.match[1]);

    const session = activeSessions.get(userId);
    if (!session) {
      await ctx.answerCbQuery("Please join a match first!");
      return;
    }

    session.betAmount = betAmount;

    await ctx.answerCbQuery(`Bet amount set to ${betAmount} coins`);

    // Update message
    await ctx.editMessageText(
      `💰 Bet amount updated: ${betAmount} coins

  Select your prediction:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("2 Runs (1.5x)", "predict_2_runs"),
          Markup.button.callback("4 Runs (2x)", "predict_4_runs"),
        ],
        [
          Markup.button.callback("6 Runs (3x)", "predict_6_runs"),
          Markup.button.callback("Wicket (5x)", "predict_wicket"),
        ],
        [
          Markup.button.callback("Dot Ball (1.8x)", "predict_dot_ball"),
          Markup.button.callback(`💰 Bet: ${betAmount}`, `bet_${betAmount}`),
        ],
        [
          Markup.button.callback("➕ Bet 50", "bet_50"),
          Markup.button.callback("➕ Bet 100", "bet_100"),
        ],
      ])
    );
  });

  // ===== SIMULATE BALL =====
  bot.action("simulate_ball", async (ctx) => {
    const userId = ctx.from.id;
    const session = activeSessions.get(userId);

    if (!session || !session.lastPrediction) {
      await ctx.answerCbQuery("Please make a prediction first");
      return;
    }

    // Deduct bet amount
    await updateUserCoins(userId, -session.betAmount);

    // Generate ball outcome
    const outcome = gameLogic.generateBallOutcome();

    const isWinner = gameLogic.checkPrediction(session.lastPrediction, outcome);

    // Calulate winnings
    let winnings = 0;
    let resultMessage = "";

    if (isWinner) {
      winnings = gameLogic.calculateWinnings(
        session.lastPrediction,
        session.betAmount
      );

      await updateUserCoins(userId, winnings + session.betAmount);
      resultMessage = `🎉 YOU WON! +${winnings} coins`;
      // Update total_wins
      await db.query(
        `
          UPDATE users
          SET total_wins = total_wins+1
          WHERE user_id = $1;
        `,
        [userId]
      );
    } else {
      resultMessage = "❌ You lost this round";
      await db.query(
        `
          UPDATE users
          SET total_losses = total_losses+1
          WHERE user_id = $1;
        `,
        [userId]
      );
    }

    // Update match ball in database
    const activeMatch = await getActiveMatch();
    if (activeMatch) {
      await gameLogic.updateMatchBall(activeMatch.match_id, outcome);
    }

    // Save to history
    try {
      await db.query(
        `INSERT INTO predictions (user_id, match_id, ball_number, prediction_type, actual_result, coins_bet, coins_won, is_winner )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          userId,
          activeMatch?.match_id || 1,
          await gameLogic.getNextBallNumber(activeMatch?.match_id || 1),
          session.lastPrediction,
          outcome.type === "wicket" ? "WICKET" : `${outcome.value} runs`,
          session.betAmount,
          winnings,
          isWinner,
        ]
      );
    } catch (error) {
      console.error(`Error saving prediction: ${error}`);
    }

    // Show result
    const outcomeText =
      outcome.type === "wicket"
        ? "WICKET!"
        : `${outcome.value} run${outcome.value !== 1 ? "s" : ""}`;

    await ctx.editMessageText(
      `🎲 BALL RESULT: ${outcomeText}

  ${resultMessage}
  💰 Bet: ${session.betAmount} coins
  ${isWinner ? `💰 Won: ${winnings} coins` : ""}
  💰 New balance: ${await getUserCoins(userId)} coins

  ${
    (await getUserCoins(userId)) < 10
      ? "⚠️ Low coins! Need at least 10 to play."
      : "Ready for next prediction!"
  }`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🎮 PLAY AGAIN", "play_again")],
        [Markup.button.callback("📊 View History", "view_history")],
        [Markup.button.callback("🏠 Main Menu", "main_menu")],
      ])
    );

    // Clear prediction for next round
    session.lastPrediction = null;
  });

  // ===== OTHER BUTTON HANDLERS =====

  bot.action("play_again", async (ctx) => {
    const userId = ctx.from.id;
    const userCoins = await getUserCoins(userId);

    if (userCoins < 10) {
      await ctx.editMessageText(
        `❌ NOT ENOUGH COINS!

  💰 Current balance: ${userCoins}
  🎮 Minimum needed: 10 coins

  Contact admin for more coins or wait for daily bonus.`,
        Markup.inlineKeyboard([
          [Markup.button.callback("🔄 Check Balance", "check_balance")],
          [Markup.button.callback("🏠 Main Menu", "main_menu")],
        ])
      );
      return;
    }

    await ctx.editMessageText(
      `💰 Your coins: ${userCoins}

  Place your prediction for the next ball!`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("2 Runs (1.5x)", "predict_2_runs"),
          Markup.button.callback("4 Runs (2x)", "predict_4_runs"),
        ],
        [
          Markup.button.callback("6 Runs (3x)", "predict_6_runs"),
          Markup.button.callback("Wicket (5x)", "predict_wicket"),
        ],
        [
          Markup.button.callback("Dot Ball (1.8x)", "predict_dot_ball"),
          Markup.button.callback("💰 Bet: 10", "bet_10"),
        ],
      ])
    );
  });

  bot.action("view_history", async (ctx) => {
    const userId = ctx.from.id;
    try {
      const history = await db.query(
        `SELECT prediction_type, actual_result, coins_bet, coins_won, is_winner, created_at
        FROM predictions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 5`,
        [userId]
      );

      if (history.rows.length === 0) {
        await ctx.editMessageText(
          "📊 No prediction history yet.\nMake your first prediction!",
          Markup.inlineKeyboard([
            [Markup.button.callback("🎮 MAKE PREDICTION", "play_again")],
          ])
        );
        return;
      }

      let historyText = "📊 YOUR LAST 5 PREDICTIONS:\n\n";

      history.rows.forEach((pred, index) => {
        const predType =
          gameLogic.predictionTypes[pred.prediction_type]?.label ||
          pred.prediction_type;
        const result = pred.is_winner ? "✅ WON" : "❌ LOST";
        historyText += `${index + 1}. ${predType} → ${pred.actual_result}\n`;
        historyText += `   Bet: ${pred.coins_bet} | ${result} | ${pred.coins_won} coins\n`;
        historyText += `   ${new Date(
          pred.created_at
        ).toLocaleTimeString()}\n\n`;
      });

      // Get stats
      const stats = await db.query(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN is_winner THEN 1 ELSE 0 END) as wins,
          SUM(coins_won) as total_won
          FROM predictions
          WHERE user_id = $1`,
        [userId]
      );

      if (stats.rows.length > 0) {
        const stat = stats.rows[0];
        historyText += `📈 STATS:\n`;
        historyText += `Total Predictions: ${stat.total || 0}\n`;
        historyText += `Wins: ${stat.wins || 0}\n`;
        historyText += `Total Coins Won: ${stat.total_won || 0}`;
      }

      await ctx.editMessageText(
        historyText,
        Markup.inlineKeyboard([
          [Markup.button.callback("🎮 PLAY AGAIN", "play_again")],
          [
            Markup.button.callback(
              "📋 Full History (/history)",
              "full_history"
            ),
          ],
          [Markup.button.callback("🏠 Main Menu", "main_menu")],
        ])
      );
    } catch (error) {
      console.error(`Error fetching history: ${error}`);
      await ctx.editMessageText(
        "Error loading history.",
        Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Back", "play_again")],
        ])
      );
    }
  });

  bot.action("main_menu", async (ctx) => {
    const userId = ctx.from.id;
    const userCoins = await getUserCoins(userId);

    await ctx.editMessageText(
      `🏏 CRICKET PREDICTION GAME

  💰 Your coins: ${userCoins}
  🎮 Ready to play?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🎮 JOIN MATCH", "join_match")],
        [Markup.button.callback("💰 Check Coins", "check_balance")],
        [Markup.button.callback("📊 My History", "view_history")],
        [Markup.button.callback("📋 All Commands", "show_help")],
      ])
    );
  });

  bot.action("check_balance", async (ctx) => {
    const userId = ctx.from.id;
    const userCoins = await getUserCoins(userId);

    await ctx.answerCbQuery(`Balance: ${userCoins} coins.`);
  });

  bot.action("show_help", async (ctx) => {
    await ctx.editMessageText(
      `📚 AVAILABLE COMMANDS:

  /start - Register/Start
  /join - Join current match
  /coins - Check your coins
  /profile - View profile
  /history - Prediction history
  /leaderboard - Top players
  /help - Show this help

  🎮 GAME RULES:
  • Min bet: 10 coins
  • Predict ball outcome
  • Win multipliers: 1.5x to 5x
  • No real money involved`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🏠 Main Menu", "main_menu")],
        [Markup.button.callback("🎮 Play Now", "join_match")],
      ])
    );
  });

  // ===== TEXT COMMANDS =====

  bot.command("coins", async (ctx) => {
    const userCoins = await getUserCoins(ctx.from.id);
    await ctx.reply(`💰 Your current balance: ${userCoins} coins`);
  });

  bot.command("history", async (ctx) => {
    await ctx.reply("Opening your prediction history...");
    // Trigger history view
    const fakeUpdate = {
      ...ctx.update,
      callback_query: { data: "view_history", from: ctx.from },
    };
    bot.handleUpdate(fakeUpdate);
  });

  bot.command("leaderboard", async (ctx) => {
    try {
      const topPlayers = await db.query(
        `SELECT username, coins, total_wins
        FROM users
        ORDER BY coins DESC
        LIMIT 10`
      );

      let leaderboard = "🏆 TOP 10 PLAYERS:\n\n";

      topPlayers.rows.forEach((player, index) => {
        const medal =
          index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "▫️";
        leaderboard += `${medal} ${player.username || "Anonymous"}\n`;
        leaderboard += `   💰 ${player.coins} coins | 🏆 ${
          player.total_wins || 0
        } wins\n\n`;
      });

      await ctx.reply(leaderboard);
    } catch (error) {
      console.error(`Error fetching leaderboard: ${error}`);
      ctx.reply("Error loading leaderboard.");
    }
  });

  bot.command("help", async (ctx) => {
    ctx.reply(
      `📚 For command list and game rules, use /start or click the button below.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📋 Show Help", "show_help")],
      ])
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
