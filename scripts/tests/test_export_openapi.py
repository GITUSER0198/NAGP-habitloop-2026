"""Merging must preserve distinct service schemas and authentication references."""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from openapi_spec_validator import validate


@pytest.fixture
def exporter() -> ModuleType:
    path = Path(__file__).resolve().parents[1] / "export-openapi.py"
    spec = importlib.util.spec_from_file_location("export_openapi", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def document(route: str, value_type: str) -> dict[str, Any]:
    return {
        "openapi": "3.1.0", "info": {"title": route, "version": "1"},
        "paths": {route: {"get": {
            "operationId": "get_item", "security": [{"HTTPBearer": []}],
            "responses": {"200": {"description": "OK", "content": {"application/json": {
                "schema": {"$ref": "#/components/schemas/Item"},
            }}}},
        }}},
        "components": {"schemas": {"Item": {"type": value_type}},
                       "securitySchemes": {"HTTPBearer": {"type": "http", "scheme": "bearer"}}},
    }


def test_colliding_names_are_namespaced_without_mutating_sources(exporter: ModuleType) -> None:
    documents = {"user-service": document("/api/users/me", "string"),
                 "activity-service": document("/api/activities", "integer")}
    merged = exporter.merge(documents, "https://example.com")
    validate(merged)
    schemas = merged["components"]["schemas"]
    assert schemas["user_service__Item"]["type"] == "string"
    assert schemas["activity_service__Item"]["type"] == "integer"
    operation = merged["paths"]["/api/users/me"]["get"]
    assert operation["security"] == [{"user_service__HTTPBearer": []}]
    assert operation["operationId"] == "user_service__get_item"
    assert documents["user-service"]["paths"]["/api/users/me"]["get"]["operationId"] == "get_item"


def test_duplicate_paths_are_rejected(exporter: ModuleType) -> None:
    with pytest.raises(ValueError, match="Duplicate API path"):
        exporter.merge({"one": document("/same", "string"), "two": document("/same", "integer")}, "/")
