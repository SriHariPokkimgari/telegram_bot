import db from "../services/db.js";

async function startNewMatch() {
  try {
    // End any existing live match
    await db.query(
      `UPDATE matches 
            SET status = 'completed',
            ended_at= CURRENT_TIMESTAMP
            WHERE status = 'live'`
    );

    // Start new match
    const result = await db.query(
      `INSERT INTO matches (match_name, status, total_overs, team_a, team_b, started_at)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            RETURNING match_id`,
      ["India vs Pakistan - T20", "live", 20, "India", "Pakistan"]
    );

    console.log(`🎮 New match started! ID: ${result.rows[0].match_id}`);
    console.log("🏏 India vs Pakistan - T20");
    console.log("⏰ Match is now LIVE");

    return result.rows[0].match_id;
  } catch (error) {
    console.error(`Error starting match: ${error}`);
  }
}

startNewMatch();
