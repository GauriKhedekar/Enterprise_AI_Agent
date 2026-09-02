"""Quick standalone test for the MONGO_URL in backend/.env.

Run from the backend folder:
    ..\.venv\Scripts\python.exe test_mongo_connection.py
"""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient

    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        print("MONGO_URL is not set in .env")
        return

    print("Connecting with:", mongo_url.split("@")[-1])  # hides credentials, shows host

    client_kwargs = {"serverSelectionTimeoutMS": 15000}

    # Only force TLS/certifi for Atlas (mongodb+srv://) connections.
    # A plain mongodb://localhost connection must NOT have TLS options,
    # or pymongo will attempt a TLS handshake against a non-TLS local server.
    if mongo_url.startswith("mongodb+srv://"):
        import certifi
        client_kwargs["tlsCAFile"] = certifi.where()

    client = AsyncIOMotorClient(mongo_url, **client_kwargs)
    try:
        result = await client.admin.command("ping")
        print("Connection OK:", result)
        db_name = os.environ.get("DB_NAME", "app")
        db = client[db_name]
        collections = await db.list_collection_names()
        print(f"Database '{db_name}' collections:", collections or "(empty, that's fine on first run)")
    except Exception as e:
        print("Connection FAILED:", repr(e))
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())