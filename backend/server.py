from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, db  # noqa: E402
from routers.auth import router as auth_router  # noqa: E402
from routers.company import router as company_router  # noqa: E402
from routers.employee import router as employee_router  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("email", unique=True)
    await db.users.create_index("company_id")
    await db.employees.create_index([("company_id", 1), ("employee_code", 1)])
    await db.api_keys.create_index("company_id")
    await db.mcp_tools.create_index("company_id")
    await db.mcp_tools.create_index([("company_id", 1), ("name", 1)], unique=True)
    await db.policies.create_index("company_id")
    await db.runs.create_index("company_id")
    yield
    client.close()


app = FastAPI(lifespan=lifespan, title="Adaptive Enterprise Agent")

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Adaptive Enterprise Agent API", "status": "ok"}


api_router.include_router(auth_router)
api_router.include_router(company_router)
api_router.include_router(employee_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Include the router in the main app — must stay the last statement.
app.include_router(api_router)
