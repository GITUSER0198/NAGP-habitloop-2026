"""Public onboarding and tenant-scoped profile endpoints."""

import logging
import secrets
from typing import Annotated
from uuid import UUID

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from habitloop_shared.auth import CurrentUser, current_user, encode_token, internal_only
from habitloop_shared.db import get_db

from app.models import Tenant, User
from app.schemas import (
    AuthResponse, LoginRequest, Profile, ProfilePatch, RegisterRequest, TenantLookup, tenant_slug,
)

router = APIRouter(prefix="/api/users", tags=["users"])
logger = logging.getLogger(__name__)
Database = Annotated[Session, Depends(get_db)]
Identity = Annotated[CurrentUser, Depends(current_user)]
# Unknown accounts still perform a bcrypt verification before returning the same error.
_dummy_hash = bcrypt.hashpw(secrets.token_bytes(32), bcrypt.gensalt())


def auth_response(user: User) -> AuthResponse:
    return AuthResponse(
        token=encode_token(user.id, user.tenant_id, user.email, user.name),
        user=Profile.model_validate(user),
    )


def find_user(db: Session, user_id: UUID, tenant_id: str) -> User:
    user = db.scalar(select(User).where(
        User.id == user_id, User.tenant_id == UUID(tenant_id),
    ))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(body: RegisterRequest, db: Database) -> AuthResponse:
    slug = tenant_slug(body.tenant_name)
    # Onboarding resolves the tenant before a bearer token can exist.
    tenant = db.scalar(select(Tenant).where(Tenant.slug == slug))
    if tenant is None:
        try:
            with db.begin_nested():
                tenant = Tenant(name=body.tenant_name, slug=slug)
                db.add(tenant)
                db.flush()
        except IntegrityError:
            # A concurrent registration may have created the same tenant.
            tenant = db.scalar(select(Tenant).where(Tenant.slug == slug))
            if tenant is None:
                raise
    if db.scalar(select(User.id).where(
        User.tenant_id == tenant.id, User.email == body.email,
    )) is not None:
        raise HTTPException(status_code=409, detail="Email already registered in this tenant")
    user = User(
        tenant_id=tenant.id, email=body.email, name=body.name, timezone=body.timezone,
        password_hash=bcrypt.hashpw(
            body.password.get_secret_value().encode("utf-8"), bcrypt.gensalt(),
        ).decode("ascii"),
    )
    tenant_id = tenant.id
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # The database also enforces uniqueness for simultaneous registrations.
        if db.scalar(select(User.id).where(
            User.tenant_id == tenant_id, User.email == body.email,
        )) is None:
            raise
        raise HTTPException(
            status_code=409, detail="Email already registered in this tenant",
        ) from None
    return auth_response(user)


@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest, db: Database) -> AuthResponse:
    tenant = db.scalar(select(Tenant).where(Tenant.slug == body.tenant_slug))
    user = None if tenant is None else db.scalar(select(User).where(
        User.tenant_id == tenant.id, User.email == body.email,
    ))
    password_hash = _dummy_hash if user is None else user.password_hash.encode("ascii")
    password = body.password.get_secret_value().encode("utf-8")
    supported_length = 1 <= len(password) <= 72
    valid = bcrypt.checkpw(password if supported_length else b"invalid", password_hash)
    valid = valid and supported_length
    if user is None or not valid:
        logger.warning("auth_failed", extra={"fields": {"tenant_slug": body.tenant_slug}})
        raise HTTPException(
            status_code=401, detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return auth_response(user)


@router.get("/me", response_model=Profile)
def me(identity: Identity, db: Database) -> User:
    return find_user(db, UUID(identity["user_id"]), identity["tenant_id"])


@router.patch("/me", response_model=Profile)
def update_me(body: ProfilePatch, identity: Identity, db: Database) -> User:
    user = find_user(db, UUID(identity["user_id"]), identity["tenant_id"])
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    return user


@router.get("/tenants/{slug}", response_model=TenantLookup)
def lookup_tenant(slug: str, db: Database) -> TenantLookup:
    tenant = db.scalar(select(Tenant).where(Tenant.slug == slug))
    return TenantLookup(exists=tenant is not None, name=None if tenant is None else tenant.name)


@router.get(
    "/internal/users/{id}", response_model=Profile, dependencies=[Depends(internal_only)],
    include_in_schema=False,
)
def internal_profile(id: UUID, identity: Identity, db: Database) -> User:
    """Internal secret authorizes the call; the bearer claim scopes its tenant."""
    return find_user(db, id, identity["tenant_id"])
