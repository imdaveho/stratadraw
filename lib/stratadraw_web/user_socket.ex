defmodule StratadrawWeb.UserSocket do
  use Phoenix.Socket

  channel("pattern:*", StratadrawWeb.PatternChannel)
  channel("document:*", StratadrawWeb.DocumentChannel)

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Phoenix.Token.verify(socket, "user socket", token, max_age: 14 * 24 * 60 * 60) do
      {:ok, user_id} -> {:ok, assign(socket, :user_id, user_id)}
      _ -> :error
    end
  end

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.user_id}"
end
