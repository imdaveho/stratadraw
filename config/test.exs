import Config

test_db_username = System.get_env("PGUSER") || "postgres"
test_db_password = System.get_env("PGPASSWORD") || "postgres"
test_db_hostname = System.get_env("PGHOST") || "localhost"
test_db_port = String.to_integer(System.get_env("PGPORT") || "5432")

test_db_name =
  System.get_env("PGDATABASE_TEST") || "stratadraw_test#{System.get_env("MIX_TEST_PARTITION")}"

# Only in tests, remove the complexity from the password hashing algorithm
config :bcrypt_elixir, :log_rounds, 1

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :stratadraw, Stratadraw.Repo,
  username: test_db_username,
  password: test_db_password,
  hostname: test_db_hostname,
  port: test_db_port,
  database: test_db_name,
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :stratadraw, StratadrawWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "qaLDssZPe5Vj0EVJPQH2SbfifiFzaAmAcgIdmko/FTDCDM3VUVJPJ1ZieWM5nKBH",
  server: false

# In test we don't send emails
config :stratadraw, Stratadraw.Mailer, adapter: Swoosh.Adapters.Test

# Disable swoosh api client as it is only required for production adapters
config :swoosh, :api_client, false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Enable helpful, but potentially expensive runtime checks
config :phoenix_live_view,
  enable_expensive_runtime_checks: true

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true
