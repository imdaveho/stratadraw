defmodule Stratadraw.Repo do
  use Ecto.Repo,
    otp_app: :stratadraw,
    adapter: Ecto.Adapters.Postgres
end
