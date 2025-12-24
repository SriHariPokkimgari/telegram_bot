import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test connection function
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("✅ Connected to PostgreSQL database");

    // Test query
    const result = await client.query(`SELECT NOW() as current_time`);
    console.log(`📅 Database time: ${result.rows[0].current_time}`);

    client.release();
    return true;
  } catch (err) {
    console.error("❌ Database connection error:", error.message);
    return false;
  }
}

// Handle pool errors
pool.on("error", (err) => {
  console.error("❌ Unexpected database error:", err);
});

export default {
  query: (text, params) => pool.query(text, params),
  pool,
  testConnection,
};
