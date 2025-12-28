import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

async function updateLiveSchema() {
  console.log("🔄 Updating database schema for live features...");

  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    await client.connect();

    // Add live match tracking columns in matches table
    await client.query(`
       ALTER TABLE matches
       ADD COLUMN IF NOT EXISTS last_ball_result VARCHAR(100), 
       ADD COLUMN IF NOT EXISTS total_balls_bowled INTEGER DEFAULT 0, 
       ADD COLUMN IF NOT EXISTS run_rate DECIMAL(5,2) DEFAULT 0.0, 
       ADD COLUMN IF NOT EXISTS required_run_rate DECIMAL(5,2) DEFAULT 0.0, 
       ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    console.log("✅ Updated matches table for live tracking");

    // Create live subscriptions table (who's watching which match)
    await client.query(`
       CREATE TABLE IF NOT EXISTS live_subscriptions(
        subscription_id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(user_id),
        match_id INTEGER REFERENCES matches(match_id),
        chat_id BIGINT, --For Private messages
        last_notified_ball VARCHAR(10),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       ); 
    `);
    console.log("✅ Created live_subscriptions table");

    // Create match events table (For ball-by-ball updtaes)
    await client.query(`
       CREATE TABLE IF NOT EXISTS match_events(
        event_id SERIAL PRIMARY KEY,
        match_id INTEGER REFERENCES matches(match_id),
        ball_number VARCHAR(10),
        event_type VARCHAR(50), -- ball_bowled, wicket, boundary, over_complete
        event_date JSONB, -- {runs: 4, batsman: 'ronaldo', bowler: 'messi'}
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       ); 
    `);
    console.log("✅ Created notifications table");

    // Add index for performance
    await client.query(`
       CREATE INDEX IF NOT EXISTS inx_live_subs_match ON live_subscriptions(match_id, is_active);
       CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events(match_id, ball_number); 
    `);
    console.log("✅ Created indexes for performance");

    console.log("\n🎉 Live schema updated successfully!");
  } catch (error) {
    console.error("❌ Error updating schema:", error.message);
  } finally {
    await client.end();
    console.log("🔗 Database connection closed");
  }
}

updateLiveSchema();
