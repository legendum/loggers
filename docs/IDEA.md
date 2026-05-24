Loggers
=======

This PWA will be hosted at loggers.dev and will provide simple quick and easy
logging sevices to PWAs like ../todos, ../fifos, ../chats2me, and ../legendum.

Schema design
-------------
We will use SQLite with WAL mode.

It will differ a little from the other repos, in that we will have a table of
"loggers" that holds a tuple of:
- `user_id` (owner)
- `name`
- `slug` (unique for user)
- `ulid`

Then we will have a separate database for the `ulid`, with 1 table:

logger:
- `id` [auto-increment integer]
- `created_at` [the Unix epoch integer]
- `updated_at` [the Unix epoch integer]
- `level` [debug/info/warn/error/test]
- `data` (JSON text)
- `meta` (JSON text)

Questions
---------
- can we hold lots of databases open at the same time? need a strategy
- can we use Redis as a buffer when writing log lines to the databases?

