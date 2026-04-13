defmodule StratadrawWeb.DocumentChannel do
  use StratadrawWeb, :channel

  alias Stratadraw.Accounts
  alias Stratadraw.Accounts.Scope
  alias Stratadraw.Patterns
  alias StratadrawWeb.PatternPayload

  @impl true
  def join("document:" <> document_id, _params, socket) do
    with {:ok, scope} <- scope_from_socket(socket),
         document when not is_nil(document) <- Patterns.get_document_for_user(scope, document_id) do
      {:ok, %{document: PatternPayload.document(document)},
       assign(socket, :document_id, document.id)}
    else
      _ -> {:error, %{reason: "unauthorized"}}
    end
  end

  @impl true
  def handle_in("document:update", payload, socket) do
    attrs = %{
      "markdown" => Map.get(payload, "markdown", ""),
      "ydoc_state" => decode_binary(Map.get(payload, "snapshot", ""))
    }

    case Patterns.update_document(scope_from_socket!(socket), socket.assigns.document_id, attrs) do
      {:ok, document} ->
        StratadrawWeb.Endpoint.broadcast(
          "pattern:#{document.pattern_id}",
          "document:updated",
          %{id: document.id, markdown: document.markdown}
        )

        broadcast_from!(socket, "document:updated", %{
          id: document.id,
          update: Map.get(payload, "update", ""),
          markdown: document.markdown
        })

        {:reply, {:ok, %{document: PatternPayload.document(document)}}, socket}

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

  defp decode_binary(""), do: <<>>
  defp decode_binary(data), do: Base.decode64!(data)

  defp translate_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
  end
end
