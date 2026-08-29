"""Company-scoped MCP registry tests."""

import pytest

from lib.security import CurrentUser
from models.schemas import McpToolCreate, new_id, utcnow


class StubUser(CurrentUser):
    def __init__(self, company_id: str, email: str = "admin@example.com") -> None:
        self.id = new_id()
        self.company_id = company_id
        self.email = email
        self.role = "company_admin"
        self.employee_code = None


@pytest.mark.asyncio
async def test_admin_created_enabled_tool_is_visible_to_employees(monkeypatch):
    import os

    import routers.company as company
    import routers.employee as employee
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    test_db = client[os.environ.get("DB_NAME", "app")]
    monkeypatch.setattr(company, "db", test_db)
    monkeypatch.setattr(employee, "db", test_db)

    company_id = new_id()
    other_company_id = new_id()
    user = StubUser(company_id)
    other_user = StubUser(other_company_id, "other@example.com")

    try:
        created = await company.create_mcp_tool(
            McpToolCreate(
                name="get_employee_details",
                display_name="Get Employee Details",
                description="Read-only employee lookup",
                kind="read",
                server_url="local://hr-mcp",
                input_schema={"type": "object"},
                enabled_for_employees=True,
            ),
            user,
        )
        await company.create_mcp_tool(
            McpToolCreate(
                name="submit_wfh_request",
                display_name="Submit WFH Request",
                description="Disabled action tool",
                kind="action",
                server_url="local://hr-mcp",
                input_schema={"type": "object"},
                enabled_for_employees=False,
            ),
            user,
        )
        await company.create_mcp_tool(
            McpToolCreate(
                name="northwind_only",
                display_name="Northwind Only",
                description="Other tenant tool",
                kind="read",
                server_url="local://other",
                input_schema={},
                enabled_for_employees=True,
            ),
            other_user,
        )

        visible = await employee.visible_mcp_tools(user)
        assert [tool.id for tool in visible] == [created.id]
        assert visible[0].name == "get_employee_details"
    finally:
        await test_db.mcp_tools.delete_many({"company_id": {"$in": [company_id, other_company_id]}})
        client.close()
