import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config();

async function setupDatabase() {
  console.log(`Setting up Cricket Game Database...`);

  //First, Connect to default postgres database
  const adminClient = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "postgres",
  });
  let gameClient;
  try {
    await adminClient.connect();
    console.log("Connected to postgreSQL server");

    //Check if database exits
    const dbCheck = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [process.env.DB_NAME]
    );

    if (dbCheck.rows.length === 0) {
      await adminClient.query(`CREATE DATABASE ${process.env.DB_NAME}`);
      console.log(`✅ Database "${process.env.DB_NAME}" created`);
    } else {
      console.log(`✅ Database "${process.env.DB_NAME}" already exists`);
    }

    await adminClient.end();

    // Now connect to our game database
    gameClient = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    await gameClient.connect();
    console.log(`✅ Connected to "${process.env.DB_NAME}" database`);

    // === Create tables ===

    // 1.User Table
    await gameClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                user_id BIGINT PRIMARY KEY,
                username VARCHAR(255),
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                coins INTEGER DEFAULT ${process.env.INITIAL_COINS || 1000},
                join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    console.log("✅ Users table created/verified");

    // 2. Match Table
    await gameClient.query(`
            CREATE TABLE IF NOT EXISTS matches(
                match_id SERIAL PRIMARY KEY,
                match_name VARCHAR(255),
                status VARCHAR(50) DEFAULT 'pending', -- pending, live, completed
                current_over INTEGER DEFAULT 0,
                current_ball INTEGER DEFAULT 0,
                total_overs INTEGER DEFAULT 20,
                team_a_score INTEGER DEFAULT 0,
                team_b_score INTEGER DEFAULT 0,
                wickets INTEGER DEFAULT 0,
                batting_team VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                ended_at TIMESTAMP
            );
        `);
    console.log("✅ Matches table created/verified");

    //3. Prediction History Table
    await gameClient.query(`
           CREATE TABLE IF NOT EXISTS predictions (
            prediction_id SERIAL PRIMARY KEY,
            user_id BIGINT REFERENCES users(user_id),
            match_id INTEGER REFERENCES matches(match_id),
            ball_number INTEGER, -- e.g., 5.4 (over.ball)
            prediction_type VARCHAR(50), -- 'runs', 'wickets', 'bounderies'
            prediction_value INTEGER, -- e.g., 2 runs, 3runs, ect
            actual_result VARCHAR(100), -- what actually happened
            coins_bet INTEGER,
            coins_won INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_winner BOOLEAN 
           );
        `);
    console.log("✅ Predictions table created/verified");

    // 4. Admin Actions Table (for audit)
    await gameClient.query(`
           CREATE TABLE IF NOT EXISTS admin_actions(
            action_id SERIAL PRIMARY KEY,
            admin_id BIGINT,
            action_type VARCHAR(100), -- add_coins, reset_coins, start_match
            target_user_id BIGINT,
            amount INTEGER,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           ); 
        `);
    console.log("✅ Admin actions table created/verified");

    // Create a defult match
    const matchCheck = await gameClient.query(
      `SELECT 1 FROM matches WHERE match_name = 'Default T20 match'`
    );

    if (matchCheck.rows.length === 0) {
      await gameClient.query(`
                INSERT INTO matches (match_name, status, total_overs)
                VALUES ('Default T20 Match', 'pending', 20);
            `);
      console.log("✅ Default match created");
    }

    console.log("\n🎉 Database setup completed successfully!");
    console.log("\n📊 Tables created:");
    console.log("  1. users - Player information & coins");
    console.log("  2. matches - Match details & status");
    console.log("  3. predictions - Game history");
    console.log("  4. admin_actions - Audit trail");
  } catch (error) {
    console.error("❌ Error setting up database:", error.message);
    process.exit(1);
  } finally {
    if (gameClient) await gameClient.end();
    console.log("\n🔗 Database connection closed");
  }
}

setupDatabase();
