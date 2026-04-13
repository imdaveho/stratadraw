defmodule StratadrawWeb.Presence do
  use Phoenix.Presence,
    otp_app: :stratadraw,
    pubsub_server: Stratadraw.PubSub
end
