const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://navyanawal4396_db_user:0yPonZWpSt2hN16U@cluster0.9yh7edf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

async function testConnection() {
  const client = new MongoClient(uri);
  try {
    console.log("Connecting to MongoDB Atlas...");
    await client.connect();
    console.log("Connected successfully to MongoDB Atlas!");
    const db = client.db("arigato_iot");
    const collections = await db.listCollections().toArray();
    console.log("Existing collections in 'arigato_iot':", collections.map(c => c.name));
    
    // Quick ping test
    const pingResult = await client.db("admin").command({ ping: 1 });
    console.log("Ping result:", pingResult);
  } catch (err) {
    console.error("Connection failed:", err.message);
  } finally {
    await client.close();
  }
}

testConnection();
