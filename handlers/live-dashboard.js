import db from "../services/db.js";

class LiveDashboard {
  constructor(bot) {
    this.bot = bot;
    this.activeMatches = new Map(); // matche_id => {subscribers, lastball}
  }

  // ========== SUBSCRIPTION MANAGEMENT ==========

  async subscribeToMatch(userId, chatId, matchId) {
    try {
      // Remove old subscriptios from this user
      await db.query(
        `UPDATE live_subscriptions SET is_active = false
                WHERE user_id = $1`,
        [userId]
      );

      // Add new subscription
      await db.query(
        `INSERT INTO live_subscriptions (user_id, match_id, chat_id, is_active)
                VALUES ($1, $2, $3, true)`,
        [userId, matchId, chatId]
      );
      console.log(`📡 User ${userId} subscribed to match ${matchId}`);
      return true;
    } catch (error) {
      console.log(`Error subscribing to match: ${error}`);
      return false;
    }
  }

  async unSubscribeFromMatch(userId) {
    try {
      await db.query(
        `UPDATE live_subscriptions SET is_active = false
                WHERE user_id = $1`,
        [userId]
      );
      return true;
    } catch (error) {
      console.error(`Error unsubscribing at "live-dashboard": ${error}`);
      return false;
    }
  }

  async getSubscribers(matchId) {
    try {
      const result = await db.query(
        `SELECT user_id, chat_id FROM live_subscriptions
                WHERE match_id = $1 AND is_active= true`,
        [matchId]
      );
      return result.rows;
    } catch (error) {
      console.error(`Error getting subscribers at "live-dashboard": ${error}`);
      return [];
    }
  }

  // ========== DASHBOARD UPDATES ==========

  async sendLiveDashboard(userId, chatId, matchId) {
    try {
      const match = await this.getMatchDetails(matchId);
      if (!match) return false;

      const dashboard = this.createDashboardMessage(match);

      // Send or update dashboard
      await this.bot.telegram.sendMessage(chatId, dashboard.message, {
        parse_mode: "Markdown",
        reply_markup: dashboard.keyboard,
      });

      return true;
    } catch (error) {
      console.error(`Error sending dashboard at "live-dashboard": ${error}`);
      return false;
    }
  }

  async updateDashboardForAll(matchId) {
    const subscribers = await this.getSubscribers(matchId);
    const match = await this.getMatchDetails(matchId);

    if (!match) return;

    const dashboard = this.createDashboardMessage(match);

    // Update each subscriber
    for (const sub of subscribers) {
      try {
        await this.bot.telegram.sendMessage(sub.chat_id, dashboard.message, {
          parse_mode: "Markdown",
          reply_markup: dashboard.keybord,
        });
      } catch (error) {
        console.error(
          `Error updating dashboard for user ${sub.user_id} at "live-dashboard": ${error} `
        );
        // Remove in-active subscription
        if (error.code === 400) {
          await this.unSubscribeFromMatch(sub.user_id);
        }
      }
    }
  }

  // ========== MATCH EVENT HANDLING ==========

  async recordBallEvent(matchId, ballData) {
    try {
      // Record event
      await db.query(
        `INSERT INTO match_events (match_id, ball_number, event_type, event_date)
                VALUES ($1, $2, $3, $4)`,
        [matchId, ballData.ballNumber, "ball-bowled", ballData]
      );

      // Update match summary
      await db.query(
        `UPDATE matches
                SET last_ball_result = $1,
                    total_balls_bowled = total_balls_bowled+1,
                    last_updated = CURRENT_TIMESTAMP
                WHERE match_id = $2
                `,
        [ballData.result, matchId]
      );

      // Calculate run rate
      const match = await this.getMatchDetails(matchId);
      if (match) {
        const overs = match.current_over + match.current_ball / 6;
        const runRate = match.team_a_score / overs;

        await db.query(
          `UPDATE matches SET run_rate = $1
                    WHERE match_id = $2`,
          [runRate.toFixed(2), matchId]
        );
      }

      return true;
    } catch (error) {
      console.log(`Error recording ball event: ${error}`);
      return false;
    }
  }

  async sendBallNotification(matchId, ballData) {
    const subscribers = await this.getSubscribers(matchId);
    const match = await this.getMatchDetails(matchId);

    if (!match) return;

    const notification = this.createBallNotificatios(match, ballData);

    for (const sub of subscribers) {
      try {
        // Send ball-by-ball update
        await this.bot.telegram.sendMessage(sub.chat_id, notification, {
          parse_mode: "Markdown",
        });
      } catch (error) {
        console.error(
          `Error sending notificatio to ${sub.user_id} at "live-dashboard": ${error}`
        );
      }
    }
  }

  // ========== HELPER METHODS ==========

  async getMatchDetails(matchId) {
    try {
      const result = await db.query(
        `SELECT * FROM matches 
                WHERE match_id = $1;`,
        [matchId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error(
        `Error getting match details at "live-dashboard": ${error}`
      );
      return null;
    }
  }

  createDashboardMessage(match) {
    const overProgress = (match.current_ball / 6) * 100;
    const progressBar = this.createProgressBar(overProgress);

    const message = `*🏏 LIVE DASHBOARD* 
    
*${match.team_a} vs ${match.team_b}*
${match.match_name}

📊 *SCOREBOARD*
${match.team_a}: *${match.team_a_score}/${match.wickets}*
Overs: *${match.current_over}.${match.current_ball}* ${progressBar}
Run Rate: *${match.run_rate || "0.00"}*
Required RR: *${match.required_run_rate || "N/A"}*

🎯 *LAST BALL*
${match.last_ball_result || "Match about to start..."}

⏰ *MATCH STATUS*
${this.getMatchStatus(match.status)}

🔄 Last updated: ${new Date(match.last_updated).toLocaleTimeString()}`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "🎯 Make Prediction", callback_data: "make_prediction" },
          { text: "📊 Match Stats", callback_data: "match_stats" },
        ],
        [
          { text: "👤 My Predictions", callback_data: "my_predictions" },
          { text: "🏆 Leaderboard", callback_data: "match_leaderboard" },
        ],
        [
          { text: "🔄 Refresh", callback_data: "refresh_dashboard" },
          { text: "🔔 Notifications", callback_data: "notification_settings" },
        ],
        [
          { text: "📱 Private Dashboard", callback_data: "private_dashboard" },
          { text: "❌ Leave Match", callback_data: "leave_match" },
        ],
      ],
    };
    return { message, keyboard };
  }

  createBallNotificatios(match, ballData) {
    const emoji = this.getBallEmoji(ballData.result);

    return `*${emoji} BALL UPDATE* 
    
*Over ${ballData.ballNumber}*
Result: *${ballData.result}*

📊 *NEW SCORE*
${match.team_a}: *${match.team_a_score + (ballData.runs || 0)}/${
      match.wickets + (ballData.wicket ? 1 : 0)
    }*

${ballData.description || ""}

🎯 *Next ball starting soon...*`;
  }

  createProgressBar(percentage) {
    const filled = "█";
    const empty = "░";
    const total = 10;
    const filledCount = Math.round((percentage / 100) * total);
    return filled.repeat(filledCount) + empty.repeat(total - filledCount);
  }

  getMatchStatus(status) {
    const statusMap = {
      pending: "⏳ Starting soon...",
      live: "🔥 LIVE NOW",
      completed: "✅ Match Completed",
      paused: "⏸️ Match Paused",
    };
    return statusMap[status] || status;
  }

  getBallEmoji(result) {
    if (result.includes("6")) return "💥";
    if (result.includes("4")) return "🎯";
    if (result.includes("WICKET")) return "🎳";
    if (result.includes("0")) return "⭕";
    return "🏏";
  }

  // ========== PRIVATE DASHBOARD ==========

  async sendPrivateDashboard(userId, chatId) {
    try {
      // Get user stats
      const userStats = await db.query(
        `SELECT 
                u.coins,
                COUNT(p.prediction_id) as total_predictions,
                SUM(CASE WHEN p.is_winner THEN 1 ELSE 0 END) as wins,
                SUM(p.coins_won) as total_won,
                u.last_active
            FROM users u LEFT JOIN predictions p ON u.user_id = p.user_id
            WHERE u.user_id = $1
            GROUP BY u.user_id;
            `,
        [userId]
      );

      const stats = userStats.rows[0] || {
        coins: 0,
        total_predictions: 0,
        wins: 0,
        total_won: 0,
      };

      const winRate =
        stats.total_predictions > 0
          ? ((stats.wins / stats.total_predictions) * 100).toFixed(1)
          : "0.0";

      // Get active match
      const activeMatch = await db.query(
        `SELECT * FROM matches 
            WHERE status = 'live'
            ORDER BY match_id DESC
            LIMIT 1
            `
      );

      const match = activeMatch.rows[0];
      let message = `*👤 PRIVATE DASHBOARD*
      
💰 *COINS:* ${stats.coins}
📊 *STATS:* ${stats.wins}W / ${
        stats.total_predictions - stats.wins
      }L (${winRate}%)
🎯 *TOTAL WON:* ${stats.total_won || 0} coins
🕒 *LAST ACTIVE:* ${new Date(stats.last_active).toLocaleTimeString()}`;

      if (match) {
        message += `\n\n*🎮 ACTIVE MATCH*
${match.match_name}
📊 ${match.team_a}: ${match.team_a_score}/${match.wickets} (${
          match.current_over
        }.${match.current_ball})
🔄 Last ball: ${match.last_ball_result || "None"}`;
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: "🎯 Quick Predict", callback_data: "quick_predict" },
            { text: "💰 Add Coins", callback_data: "add_coins" },
          ],
          [
            { text: "📈 Full Stats", callback_data: "full_stats" },
            {
              text: "📋 Prediction History",
              callback_data: "prediction_history",
            },
          ],
          [
            { text: "⚙️ Settings", callback_data: "user_settings" },
            { text: "🆘 Help", callback_data: "help_private" },
          ],
          [{ text: "🏠 Main Dashboard", callback_data: "main_dashboard" }],
        ],
      };

      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });

      return true;
    } catch (error) {
      console.error(
        `Error sending private dashboard at "live-dashboard": ${error}`
      );
      return false;
    }
  }

  // ========== NOTIFICATION SYSTEM ==========

  async sendNotification(userId, type, message) {
    try {
      await db.query(
        `INSERT INTO notificatios (user_id, type, message)
            VALUES (user_id, type, message)
            `,
        [userId, type, message]
      );

      // Try to send immediately if user is online
      const subscription = await db.query(
        `SELECT chat_id FROM live_subscriptions
            WHERE user_id = $1 AND is_active = true
            LIMIT 1;
            `,
        [userId]
      );

      if (subscription.rows.length > 0) {
        await this.bot.telegram.sendMessage(
          subscription.rows[0].chat_id,
          `🔔 *NOTIFICATION:* ${message}`,
          { parse_mode: "Markdown" }
        );
      }

      return true;
    } catch (error) {
      console.error(
        `Error sending notifications at "live-dashboard": ${error}`
      );
      return false;
    }
  }
}

export default LiveDashboard;
