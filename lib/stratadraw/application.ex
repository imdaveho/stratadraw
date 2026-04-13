defmodule Stratadraw.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      StratadrawWeb.Telemetry,
      Stratadraw.Repo,
      {DNSCluster, query: Application.get_env(:stratadraw, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Stratadraw.PubSub},
      StratadrawWeb.Presence,
      # Start a worker by calling: Stratadraw.Worker.start_link(arg)
      # {Stratadraw.Worker, arg},
      # Start to serve requests, typically the last entry
      StratadrawWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Stratadraw.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    StratadrawWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
