# Tools and edit behavior

Start with `ynab_list_plans` to select a budget and check its currency. Other
plan-specific read tools need its `plan_id` unless a default is configured.
Write tools always require an explicit plan UUID.

## Read tools

| Tool | Returns |
| --- | --- |
| `ynab_get_status` | Server settings and write capability; does not test YNAB access |
| `ynab_list_plans` | Accessible budgets, IDs, and currency metadata |
| `ynab_get_plan_settings` | Currency and date settings |
| `ynab_list_accounts`, `ynab_get_account` | Accounts and balances |
| `ynab_list_categories`, `ynab_get_category` | Categories, targets, and amounts |
| `ynab_list_months`, `ynab_get_month` | Monthly totals and category amounts |
| `ynab_list_payees` | Payee names and IDs |
| `ynab_list_transactions`, `ynab_get_transaction` | Transactions, split lines, and review status |
| `ynab_list_scheduled_transactions` | Upcoming transactions and recurrence |

Clients can discover each tool's full input schema. The `review_budget` prompt
provides a monthly review workflow; the `ynab://guide` resource explains usage.

## Dates, money, and lists

- Dates use `YYYY-MM-DD`; months use the first day, `YYYY-MM-01`.
- Transaction lists require inclusive `since_date` and `until_date` values.
  They exclude pending transactions. Scheduled transactions are separate from
  posted spending.
- Monetary integers are **milliunits**: `-12340` means `-12.34` in the plan's
  currency. Write amounts use decimal strings such as `"-12.34"`, with at most
  three decimal places. Negative amounts are outflows; positive amounts are inflows.
- Paginated lists default to 50 records and allow up to 200. Follow `next_offset`
  until it is `null`. For `ynab_get_month`, pagination is inside `categories`;
  `ynab_list_plans` returns the complete allowed plan list.
- Filtering and pagination happen after retrieval from YNAB. Keep transaction
  date ranges narrow; upstream responses over 20 MB are rejected. Changes in
  YNAB can shift records between pages.
- A category filter can match a split transaction and return its parent. Sum
  the matching split lines, not the parent plus its children. Payee/memo search
  also includes split lines.

## Editing

[Enable edits](../README.md#enable-edits-optional) to expose these tools:

| Tool | Action | Required when saving |
| --- | --- | --- |
| `ynab_create_transaction` | Create one ordinary transaction | A UUID `idempotency_key`, also used in the preview |
| `ynab_update_transaction` | Change an ordinary transaction | The preview's `expected_fingerprint` |
| `ynab_set_category_budget` | Replace a month's assigned amount | The preview's `expected_budgeted` in milliunits |

All three default to `dry_run=true`. Preview, review the plan and changes, then
save with `dry_run=false` after authorizing the action in your client. Approval
is handled by the MCP client; the server does not show its own confirmation UI.

For transaction creation, reuse the same idempotency key and payload on retries.
It becomes a stable YNAB import ID, which helps avoid duplicates and may match an
existing manually entered transaction. New transactions default to unapproved.

Category assignments replace the month's **assigned amount**, not the available
balance and not an increment. Preview and save checks fetch fresh values, but
another client can still edit YNAB between the final check and the write.

Split, transfer, and reconciled transactions must be edited directly in YNAB.
Creating transfers or future-dated ordinary transactions is unsupported. There
are no delete, bulk-edit, account-creation, or scheduled-transaction edit tools.
These operations change YNAB records; they do not move money at a bank.
