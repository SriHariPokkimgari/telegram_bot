import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config();

async function updateSchema() {
  console.log("🔄 Updating database schema for game mechanics...");

  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    await client.connect();

    // Add columns to matches table for better game tracking
    await client.query(`
        ALTER TABLE matches
        ADD COLUMN IF NOT EXISTS current_batsman VARCHAR(100),
        ADD COLUMN IF NOT EXISTS current_bowler VARCHAR(100),
        ADD COLUMN IF NOT EXISTS team_a VARCHAR(100) DEFAULT 'Team A',
        ADD COLUMN IF NOT EXISTS team_b VARCHAR(100) DEFAULT 'Team B',
        ADD COLUMN IF NOT EXISTS target_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP; 
    `);
    console.log("✅ Updated matches table");

    // Add colums to users table
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS current_match_id INTEGER,
      ADD COLUMN IF NOT EXISTS total_wins INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_losses INTEGER DEFAULT 0;
    `);
    console.log("✅ Updated users table");

    // Create game sessions table for active predictions
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_sessions (
        session_id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(user_id),
        match_id INTEGER REFERENCES matches(match_id),
        ball_number VARCHAR(10), -- e.g., "5.3"
        prediction_type VARCHAR(50),
        prediction_value INTEGER,
        coins_bet INTEGER DEFAULT 10,
        status VARCHAR(20) DEFAULT 'pending', -- pending, won, lost
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      );
    `);
    console.log("✅ Created game_sessions table");

    console.log("\n🎉 Schema updated successfully!");
  } catch (error) {
    console.error("❌ Error updating schema:", error.message);
  } finally {
    await client.end();
    console.log("🔗 Database connection closed");
  }
}

updateSchema();
