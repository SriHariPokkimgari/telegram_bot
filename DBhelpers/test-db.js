import db from "../services/db.js";

async function test() {
  console.log("testing database connection...");

  const isConnected = await db.testConnection();

  if (isConnected) {
    const tables = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name   
    `);
    console.log(`/n Available tables: `);
    console.log(tables.rows[0]);
  }
}

test();
