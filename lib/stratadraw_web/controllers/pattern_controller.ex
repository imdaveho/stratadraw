defmodule StratadrawWeb.PatternController do
  use StratadrawWeb, :controller

  alias Stratadraw.Patterns
  alias Stratadraw.Patterns.Pattern
  alias StratadrawWeb.PatternPayload

  def index(conn, _params) do
    current_scope = conn.assigns.current_scope

    render(conn, :index,
      patterns: Patterns.list_patterns(current_scope),
      form: Patterns.change_pattern(%Pattern{}) |> Phoenix.Component.to_form(as: :pattern)
    )
  end

  def create(conn, %{"pattern" => pattern_params}) do
    current_scope = conn.assigns.current_scope

    case Patterns.create_pattern(current_scope, pattern_params) do
      {:ok, pattern} ->
        conn
        |> put_flash(:info, "Pattern created.")
        |> redirect(to: ~p"/patterns/#{pattern.id}")

      {:error, changeset} ->
        render(conn, :index,
          patterns: Patterns.list_patterns(current_scope),
          form: Phoenix.Component.to_form(changeset, as: :pattern)
        )
    end
  end

  def show(conn, %{"id" => id}) do
    pattern = Patterns.get_pattern_for_user!(conn.assigns.current_scope, id)
    socket_token = Phoenix.Token.sign(conn, "user socket", conn.assigns.current_scope.user.id)

    payload =
      pattern
      |> PatternPayload.board(conn.assigns.current_scope.user)
      |> Jason.encode!()
      |> Base.encode64()

    render(conn, :show, pattern: pattern, board_payload: payload, socket_token: socket_token)
  end
end
