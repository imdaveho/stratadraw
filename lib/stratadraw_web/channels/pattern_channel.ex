defmodule StratadrawWeb.PatternChannel do
  use StratadrawWeb, :channel

  alias Stratadraw.Accounts
  alias Stratadraw.Accounts.Scope
  alias Stratadraw.Patterns
  alias StratadrawWeb.{PatternPayload, Presence}

  @impl true
  def join("pattern:" <> pattern_id, _params, socket) do
    with {:ok, scope} <- scope_from_socket(socket),
         pattern when not is_nil(pattern) <- Patterns.get_pattern_for_user(scope, pattern_id) do
      send(self(), {:after_join, pattern_id})
      {:ok, %{pattern_id: pattern.id}, assign(socket, :pattern_id, pattern.id)}
    else
      _ -> {:error, %{reason: "unauthorized"}}
    end
  end

  @impl true
  def handle_info({:after_join, pattern_id}, socket) do
    membership = Patterns.get_pattern_membership(scope_from_socket!(socket), pattern_id)

    {:ok, _meta} =
      Presence.track(socket, socket.assigns.user_id, %{
        email: current_user(socket).email,
        color: membership.color
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  @impl true
  def handle_in("cursor:move", payload, socket) do
    broadcast_from(socket, "cursor:moved", %{
      user_id: socket.assigns.user_id,
      point: Map.get(payload, "point"),
      tool: Map.get(payload, "tool")
    })

    {:noreply, socket}
  end

  def handle_in("atom:create", payload, socket) do
    case Patterns.create_atom(scope_from_socket!(socket), socket.assigns.pattern_id, payload) do
      {:ok, atom} ->
        body = PatternPayload.atom(atom)
        broadcast!(socket, "atom:upserted", body)
        {:reply, {:ok, body}, socket}

      {:error, changeset} ->
        {:reply, {:error, %{errors: translate_errors(changeset)}}, socket}
    end
  end

  def handle_in("atom:update", %{"id" => atom_id, "attrs" => attrs}, socket) do
    case Patterns.update_atom(scope_from_socket!(socket), atom_id, attrs) do
      {:ok, atom} ->
        body = PatternPayload.atom(atom)
        broadcast!(socket, "atom:upserted", body)
        {:reply, {:ok, body}, socket}

      {:error, changeset} ->
        {:reply, {:error, %{errors: translate_errors(changeset)}}, socket}
    end
  end

  def handle_in("atom:delete", %{"id" => atom_id}, socket) do
    case Patterns.delete_atom(scope_from_socket!(socket), atom_id) do
      {:ok, _atom} ->
        broadcast!(socket, "atom:deleted", %{id: atom_id})
        {:reply, :ok, socket}

      {:error, changeset} ->
        {:reply, {:error, %{errors: translate_errors(changeset)}}, socket}
    end
  end

  def handle_in("bond:create", payload, socket) do
    case Patterns.create_bond(scope_from_socket!(socket), socket.assigns.pattern_id, payload) do
      {:ok, bond} ->
        body = PatternPayload.bond(bond)
        broadcast!(socket, "bond:upserted", body)
        {:reply, {:ok, body}, socket}

      {:error, changeset} ->
        {:reply, {:error, %{errors: translate_errors(changeset)}}, socket}
    end
  end

  def handle_in("bond:update", %{"id" => bond_id, "attrs" => attrs}, socket) do
    case Patterns.update_bond(scope_from_socket!(socket), bond_id, attrs) do
      {:ok, bond} ->
        body = PatternPayload.bond(bond)
        broadcast!(socket, "bond:upserted", body)
        {:reply, {:ok, body}, socket}

      {:error, changeset} ->
        {:reply, {:error, %{errors: translate_errors(changeset)}}, socket}
    end
  end

  def handle_in("bond:delete", %{"id" => bond_id}, socket) do
    case Patterns.delete_bond(scope_from_socket!(socket), bond_id) do
      {:ok, _bond} ->
        broadcast!(socket, "bond:deleted", %{id: bond_id})
        {:reply, :ok, socket}

      {:error, changeset} ->
        {:reply, {:error, %{errors: translate_errors(changeset)}}, socket}
    end
  end

  def handle_in("annotation:create", payload, socket) do
    case Patterns.create_annotation(
           scope_from_socket!(socket),
           socket.assigns.pattern_id,
           payload
         ) do
      {:ok, annotation} ->
        body = PatternPayload.annotation(annotation)
        broadcast!(socket, "annotation:upserted", body)
        {:reply, {:ok, body}, socket}

      {:error, changeset} ->
        {:reply, {:error, %{errors: translate_errors(changeset)}}, socket}
    end
  end

  def handle_in("annotation:update", %{"id" => annotation_id, "attrs" => attrs}, socket) do
    case Patterns.update_annotation(scope_from_socket!(socket), annotation_id, attrs) do
      {:ok, annotation} ->
        body = PatternPayload.annotation(annotation)
        broadcast!(socket, "annotation:upserted", body)
        {:reply, {:ok, body}, socket}

      {:error, changeset} ->
        {:reply, {:error, %{errors: translate_errors(changeset)}}, socket}
    end
  end

  def handle_in("annotation:delete", %{"id" => annotation_id}, socket) do
    case Patterns.delete_annotation(scope_from_socket!(socket), annotation_id) do
      {:ok, _annotation} ->
        broadcast!(socket, "annotation:deleted", %{id: annotation_id})
        {:reply, :ok, socket}

      {:error, changeset} ->
        {:reply, {:error, %{errors: translate_errors(changeset)}}, socket}
    end
  end

  defp scope_from_socket(socket) do
    case Accounts.get_user!(socket.assigns.user_id) do
      %_{} = user -> {:ok, Scope.for_user(user)}
      _ -> :error
    end
  rescue
    Ecto.NoResultsError -> :error
  end

  defp scope_from_socket!(socket) do
    {:ok, scope} = scope_from_socket(socket)
    scope
  end

  defp current_user(socket) do
    scope = scope_from_socket!(socket)
    scope.user
  end

  defp translate_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
  end
end
