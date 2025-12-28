import db from "./db.js";

class GameLogic {
  constructor() {
    // Prediction types and their multipliers
    this.predictionTypes = {
      "2_runs": {
        label: "2 Runs",
        probability: 0.4,
        multiplier: 1.5,
        minBet: 10,
        maxBet: 100,
      },
      "4_runs": {
        label: "Boundary (4)",
        probability: 0.25,
        multiplier: 2.0,
        minBet: 20,
        maxBet: 200,
      },
      "6_runs": {
        label: "Six (6)",
        probability: 0.15,
        multiplier: 3.0,
        minBet: 30,
        maxBet: 300,
      },
      wicket: {
        label: "Wicket",
        probability: 0.1,
        multiplier: 5.0,
        minBet: 50,
        maxBet: 500,
      },
      dot_ball: {
        label: "Dot Ball",
        probability: 0.3,
        multiplier: 1.8,
        minBet: 10,
        maxBet: 150,
      },
    };
  }

  // Get random ball outcome based on cricket probabilities
  generateBallOutcome() {
    const random = Math.random();
    let outcome;

    if (random < 0.1) outcome = "wicket";
    else if (random < 0.25) outcome = "6_runs";
    else if (random < 0.45) outcome = "4_runs";
    else if (random < 0.65) outcome = "2_runs";
    else if (random < 0.8) outcome = "1_run";
    else outcome = "dot_ball";

    // Add random runs for non-specific outcomes
    if (outcome === "1_run") {
      return { type: "runs", value: 1 };
    } else if (outcome === "dot_ball") {
      return { type: "runs", value: 0 };
    } else {
      const type = outcome.split("_")[1] || outcome.split("_")[0]; // 'runs' or 'wickets'
      const value = outcome.split("_")[0]; // 2, 4, 6, or 'wicket'

      return {
        type: type,
        value: type === "wicket" ? "wicket" : parseInt(value),
      };
    }
  }

  // Generate detailed ball outcome for live updates
  generateDetailedBallOutcome() {
    const outcome = this.generateBallOutcome();

    // Add cricket-specific details
    const shotTypes = ["drive", "cut", "pull", "hook", "sweep", "defensive"];
    const bowlerTypes = ["fast", "spin", "medium"];
    const fielders = ["slip", "point", "cover", "mid-wicket", "long-on"];

    const shot = shotTypes[Math.floor(Math.random() * shotTypes.length)];
    const bowler = bowlerTypes[Math.floor(Math.random() * bowlerTypes.length)];

    let description = "";

    if (outcome.type === "wicket") {
      const dismissalTypes = ["bowled", "caught", "lbw", "run out", "stumped"];
      const dismissal =
        dismissalTypes[Math.floor(Math.random() * dismissalTypes.length)];

      if (dismissal === "caught") {
        const fielder = fielders[Math.floor(Math.random() * fielders.length)];
        description = `Beautiful ${bowler} delivery! Caught by ${fielder} at ${shot} position.`;
      } else {
        description = `OUT! ${dismissal.toUpperCase()}! Great ${bowler} bowling.`;
      }
    } else if (outcome.value === 6) {
      description = `HUGE SIX! Massive ${shot} over the boundary!`;
    } else if (outcome.value === 4) {
      description = `FOUR! Elegant ${shot} through the covers.`;
    } else if (outcome.value === 0) {
      description = `Dot ball. Good ${bowler} delivery, defended well.`;
    } else {
      description = `${outcome.value} run${
        outcome.value > 1 ? "s" : ""
      }. ${shot} to ${fielders[Math.floor(Math.random() * fielders.length)]}.`;
    }

    return {
      ...outcome,
      description,
      shotType: shot,
      bowlerType: bowler,
      timestamp: new Date().toISOString(),
    };
  }

  // Check if prediction wins
  checkPrediction(predictionType, actualOutcome) {
    const prediction = this.predictionTypes[predictionType];

    if (!prediction) return false;

    // For wicket predictions
    if (predictionType === "wicket") {
      return actualOutcome.type === "wicket";
    }

    // For run predictions
    if (predictionType.includes("_runs")) {
      const expectedRuns = parseInt(predictionType.split("_")[0]);
      return (
        actualOutcome.type === "runs" && actualOutcome.value === expectedRuns
      );
    }

    // For dot ball predictions
    if (predictionType === "dot_ball") {
      return actualOutcome.type === "runs" && actualOutcome.value === 0;
    }

    return false;
  }

  // Calculate winnings
  calculateWinnings(predictionType, coinsBet) {
    const prediction = this.predictionTypes[predictionType];
    if (!prediction) return 0;

    return Math.floor(coinsBet * prediction.multiplier);
  }
  // Get next ball number
  async getNextBallNumber(matchId) {
    try {
      const result = await db.query(
        `
                SELECT current_over, current_ball FROM matches 
                WHERE match_id = $1
            `,
        [matchId]
      );

      if (result.rows.length === 0) {
        return "0.1"; // start of match
      }

      let over = result.rows[0].current_over;
      let ball = result.rows[0].current_ball + 1;

      if (ball > 6) {
        over += 1;
        ball = 1;
      }

      return `${over}.${ball}`;
    } catch (error) {
      console.error("Error getting next ball:", error);
      return "0.1";
    }
  }

  // Update match ball
  async updateMatchBall(matchId, outcome) {
    try {
      const result = await db.query(
        `
                SELECT current_over, current_ball, team_a_score, wickets FROM matches
                WHERE match_id = $1    
            `,
        [matchId]
      );

      if (result.rows.length === 0) return;

      let { current_ball, current_over, team_a_score, wickets } =
        result.rows[0];

      // Update score based on outcome
      let newScore = team_a_score;
      let newWickets = wickets;

      if (outcome.type === "runs") {
        newScore += outcome.value;
      } else if (outcome.type === "wicket") {
        newWickets += 1;
      }

      // Move to next ball
      current_ball += 1;
      if (current_ball > 6) {
        current_over += 1;
        current_ball = 1;
      }

      await db.query(
        `
            UPDATE matches 
            SET current_over = $1,
                current_ball = $2,
                team_a_score = $3,
                wickets = $4,
                last_updated = CURRENT_TIMESTAMP
            WHERE match_id = $5;    
        `,
        [current_over, current_ball, newScore, newWickets, matchId]
      );

      return {
        ballNumber: `${current_over}.${current_ball}`,
        score: newScore,
        wickets: newWickets,
      };
    } catch (error) {
      console.error("Error updating match:", error);
    }
  }

  // Get prediction buttons with dynamic odds
  getPredictionButtons() {
    const buttons = [];

    Object.entries(this.predictionTypes).forEach(([key, data]) => {
      buttons.push({
        text: `${data.label} (${data.multiplier}x)`,
        callback_data: `predict_${key}`,
      });
    });

    // Add bet amount buttons
    buttons.push({ text: "💰 Bet 10", callback_data: "bet_10" });
    buttons.push({ text: "💰 Bet 50", callback_data: "bet_50" });
    buttons.push({ text: "💰 Bet 100", callback_data: "bet_100" });

    return buttons;
  }

  //Get match summary for dashboard
  async getMatchSummary(matchId) {
    try {
      const result = await db.query(
        `SLECT
          m.*,
          COUNT(DISTINCT p.user_id) as active_palyers,
          COUNT(p.prediction_id) as total_predictions,
          SUM(CASE WHEN p.is_winner THEN p.coins_won ELSE 0 END) as total_coins_won
        FROM matches m 
        LEFT JOIN predictions p ON m.match_id = p.match_id
        WHERE m.match_id = $1
        GROUP BY m.match_id
        `,
        [matchId]
      );

      if (result.rows.length === 0) return null;

      const match = result.rows[0];

      // Get recent predictions
      const recentPreds = await db.query(
        `SELECT u.username, p.prediction_type, p.actual_result, p.is_winner
        FROM predictions p
        JOIN users u ON p.user_id = u.user_id
        WHERE p.match_id = $1
        ORDER BY p.created_at DSCE
        LIMIT 5`,
        [matchId]
      );

      // Get top predictors
      const topPredictors = await db.query(
        `SELECT u.username, COUNT(*) as total_wins,
        SUM(p.coins_won) as total_coins
        FROM predictions p 
        JOIN users u ON p.user_id = u.user_id
        WHERE p.match_id = $1 AND p.is_winner = true
        GROUP BY u.user_id , u.username
        ORDER BY total_coins DESC
        LIMIT 5`,
        [matchId]
      );

      return {
        ...match,
        recentPredictions: recentPreds.rows,
        topPredictors: topPredictors.rows,
      };
    } catch (error) {
      console.error(`Error getting match summary at "live-dashoard": ${error}`);
      return null;
    }
  }
}

export default new GameLogic();
