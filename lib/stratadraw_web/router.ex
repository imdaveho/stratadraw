defmodule StratadrawWeb.Router do
  use StratadrawWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {StratadrawWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", StratadrawWeb do
    pipe_through :browser

    get "/", PageController, :home
    get "/schemas/open", PageController, :open_schema
    get "/schemas/:code", PageController, :schema
  end

  # Other scopes may use custom stacks.
  # scope "/api", StratadrawWeb do
  #   pipe_through :api
  # end
end
