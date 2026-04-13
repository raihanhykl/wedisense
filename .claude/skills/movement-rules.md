# Asset movement business rules

## Every movement MUST:
- Use prisma.$transaction() — atomic, all or nothing
- Generate reference_number: MOV-YYYYMMDD-XXXXX (use generateMovementRef() util)
- Update assets.status, assets.location_id, assets.assigned_to_user_id atomically
- Insert into asset_movements (append-only — never update)
- Call auditLog() middleware — the middleware captures this automatically, but verify
- Trigger relevant notifications via the notification service

## Special rules per type
- SWAP: wraps TWO asset updates in ONE transaction. Both must succeed or both rollback.
- LOAN_OUT: must set expected_return_date. Reject if null.
- RESIGNATION_RETURN: accepts user_id, fetches all active assignments, bulk-returns in single transaction.
- DISPOSAL: set final current_book_value before setting status = DISPOSED.
- SEND_TO_MAINTENANCE: create a stub maintenance_log entry in same transaction.

## Approval workflow
If movement type has approval enabled in settings: create with status=PENDING.
Only transition to COMPLETED after approved_by_user_id is set by MANAGER+.
