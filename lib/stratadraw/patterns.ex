defmodule Stratadraw.Patterns do
  @moduledoc """
  The collaborative pattern graph context.
  """

  import Ecto.Query, warn: false

  alias Stratadraw.Accounts.Scope
  alias Stratadraw.Accounts.User
  alias Stratadraw.Patterns.{Annotation, Atom, Bond, Document, Pattern, PatternUser}
  alias Stratadraw.Repo

  @member_palette [
    "#22c55e",
    "#06b6d4",
    "#8b5cf6",
    "#f97316",
    "#ec4899",
    "#14b8a6",
    "#eab308"
  ]

  def list_patterns(%Scope{user: %User{id: user_id}}) do
    Pattern
    |> join(:inner, [pattern], membership in assoc(pattern, :pattern_users))
    |> where([_pattern, membership], membership.user_id == ^user_id)
    |> order_by([pattern], asc: pattern.name)
    |> preload([pattern, membership], owner: [], pattern_users: {membership, [:user]})
    |> Repo.all()
  end

  def get_pattern_for_user(%Scope{user: %User{id: user_id}}, id) do
    Pattern
    |> join(:inner, [pattern], membership in assoc(pattern, :pattern_users))
    |> where([pattern, membership], pattern.id == ^id and membership.user_id == ^user_id)
    |> preload([
      :owner,
      pattern_users: [:user],
      atoms: [:document],
      bonds: [],
      annotations: [:document]
    ])
    |> Repo.one()
  end

  def get_pattern_for_user!(%Scope{} = scope, id) do
    case get_pattern_for_user(scope, id) do
      nil -> raise Ecto.NoResultsError, queryable: Pattern
      pattern -> pattern
    end
  end

  def create_pattern(%Scope{user: %User{} = user}, attrs) do
    Repo.transact(fn ->
      with {:ok, pattern} <-
             %Pattern{}
             |> Pattern.changeset(%{
               "name" => Map.get(attrs, "name") || Map.get(attrs, :name),
               "description" => Map.get(attrs, "description") || Map.get(attrs, :description),
               "owner_id" => user.id
             })
             |> Repo.insert(),
           {:ok, _membership} <-
             %PatternUser{}
             |> PatternUser.changeset(%{
               "pattern_id" => pattern.id,
               "user_id" => user.id,
               "role" => "owner",
               "color" => member_color(user.id)
             })
             |> Repo.insert() do
        {:ok, Repo.preload(pattern, pattern_users: [:user])}
      end
    end)
    |> unwrap_transacted_result()
  end

  def change_pattern(%Pattern{} = pattern, attrs \\ %{}) do
    Pattern.changeset(pattern, attrs)
  end

  def create_atom(%Scope{} = scope, pattern_id, attrs) do
    Repo.transact(fn ->
      pattern = get_pattern_for_user!(scope, pattern_id)

      with {:ok, atom} <-
             %Atom{}
             |> Atom.changeset(
               Map.merge(default_atom_attrs(), Map.put(attrs, "pattern_id", pattern.id))
             )
             |> Repo.insert(),
           {:ok, _document} <- create_document(pattern.id, %{atom_id: atom.id, kind: "atom"}) do
        {:ok, Repo.preload(atom, :document)}
      end
    end)
    |> unwrap_transacted_result()
  end

  def update_atom(%Scope{} = scope, atom_id, attrs) do
    atom = get_atom_for_user!(scope, atom_id)

    atom
    |> Atom.changeset(attrs)
    |> Repo.update()
    |> preload_document(:document)
  end

  def delete_atom(%Scope{} = scope, atom_id) do
    scope
    |> get_atom_for_user!(atom_id)
    |> Repo.delete()
  end

  def create_bond(%Scope{} = scope, pattern_id, attrs) do
    pattern = get_pattern_for_user!(scope, pattern_id)

    %Bond{}
    |> Bond.changeset(Map.put(attrs, "pattern_id", pattern.id))
    |> validate_bond_membership(scope)
    |> Repo.insert()
  end

  def update_bond(%Scope{} = scope, bond_id, attrs) do
    bond = get_bond_for_user!(scope, bond_id)

    bond
    |> Bond.changeset(attrs)
    |> validate_bond_membership(scope)
    |> Repo.update()
  end

  def delete_bond(%Scope{} = scope, bond_id) do
    scope
    |> get_bond_for_user!(bond_id)
    |> Repo.delete()
  end

  def create_annotation(%Scope{} = scope, pattern_id, attrs) do
    Repo.transact(fn ->
      pattern = get_pattern_for_user!(scope, pattern_id)

      with {:ok, annotation} <-
             %Annotation{}
             |> Annotation.changeset(
               Map.merge(default_annotation_attrs(), Map.put(attrs, "pattern_id", pattern.id))
             )
             |> Repo.insert(),
           {:ok, _document} <-
             create_document(pattern.id, %{annotation_id: annotation.id, kind: "annotation"}) do
        {:ok, Repo.preload(annotation, :document)}
      end
    end)
    |> unwrap_transacted_result()
  end

  def update_annotation(%Scope{} = scope, annotation_id, attrs) do
    annotation = get_annotation_for_user!(scope, annotation_id)

    annotation
    |> Annotation.changeset(attrs)
    |> Repo.update()
    |> preload_document(:document)
  end

  def delete_annotation(%Scope{} = scope, annotation_id) do
    scope
    |> get_annotation_for_user!(annotation_id)
    |> Repo.delete()
  end

  def get_document_for_user(%Scope{user: %User{id: user_id}}, id) do
    Document
    |> join(:inner, [document], pattern in assoc(document, :pattern))
    |> join(:inner, [_document, pattern], membership in assoc(pattern, :pattern_users))
    |> where(
      [document, _pattern, membership],
      document.id == ^id and membership.user_id == ^user_id
    )
    |> preload([:atom, :annotation])
    |> Repo.one()
  end

  def get_document_for_user!(%Scope{} = scope, id) do
    case get_document_for_user(scope, id) do
      nil -> raise Ecto.NoResultsError, queryable: Document
      document -> document
    end
  end

  def update_document(%Scope{} = scope, document_id, attrs) do
    document = get_document_for_user!(scope, document_id)

    document
    |> Document.changeset(attrs)
    |> Repo.update()
  end

  def get_pattern_membership(%Scope{user: %User{id: user_id}}, pattern_id) do
    PatternUser
    |> where(
      [membership],
      membership.pattern_id == ^pattern_id and membership.user_id == ^user_id
    )
    |> Repo.one()
  end

  defp create_document(pattern_id, attrs) do
    %Document{}
    |> Document.changeset(
      attrs
      |> Enum.into(%{}, fn {key, value} -> {to_string(key), value} end)
      |> Map.put("pattern_id", pattern_id)
      |> Map.put_new("markdown", "")
      |> Map.put_new("ydoc_state", <<>>)
    )
    |> Repo.insert()
  end

  defp get_atom_for_user!(%Scope{user: %User{id: user_id}}, atom_id) do
    Atom
    |> join(:inner, [atom], pattern in assoc(atom, :pattern))
    |> join(:inner, [_atom, pattern], membership in assoc(pattern, :pattern_users))
    |> where([atom, _pattern, membership], atom.id == ^atom_id and membership.user_id == ^user_id)
    |> preload(:document)
    |> Repo.one!()
  end

  defp get_bond_for_user!(%Scope{user: %User{id: user_id}}, bond_id) do
    Bond
    |> join(:inner, [bond], pattern in assoc(bond, :pattern))
    |> join(:inner, [_bond, pattern], membership in assoc(pattern, :pattern_users))
    |> where([bond, _pattern, membership], bond.id == ^bond_id and membership.user_id == ^user_id)
    |> Repo.one!()
  end

  defp get_annotation_for_user!(%Scope{user: %User{id: user_id}}, annotation_id) do
    Annotation
    |> join(:inner, [annotation], pattern in assoc(annotation, :pattern))
    |> join(:inner, [_annotation, pattern], membership in assoc(pattern, :pattern_users))
    |> where(
      [annotation, _pattern, membership],
      annotation.id == ^annotation_id and membership.user_id == ^user_id
    )
    |> preload(:document)
    |> Repo.one!()
  end

  defp validate_bond_membership(changeset, scope) do
    source_id = Ecto.Changeset.get_field(changeset, :source_atom_id)
    target_id = Ecto.Changeset.get_field(changeset, :target_atom_id)

    if is_binary(source_id) and is_binary(target_id) and
         same_pattern_atoms?(scope, source_id, target_id) do
      changeset
    else
      Ecto.Changeset.add_error(
        changeset,
        :source_atom_id,
        "must connect atoms within the same accessible pattern"
      )
    end
  end

  defp same_pattern_atoms?(%Scope{user: %User{id: user_id}}, source_id, target_id) do
    Atom
    |> join(:inner, [atom], pattern in assoc(atom, :pattern))
    |> join(:inner, [_atom, pattern], membership in assoc(pattern, :pattern_users))
    |> where(
      [atom, _pattern, membership],
      membership.user_id == ^user_id and atom.id in ^[source_id, target_id]
    )
    |> select([atom], atom.pattern_id)
    |> Repo.all()
    |> Enum.uniq()
    |> case do
      [_single_pattern] -> true
      _ -> false
    end
  end

  defp member_color(user_id) do
    Enum.at(@member_palette, rem(:erlang.phash2(user_id), length(@member_palette)))
  end

  defp preload_document({:ok, entity}, preload), do: {:ok, Repo.preload(entity, preload)}
  defp preload_document(error, _preload), do: error

  defp unwrap_transacted_result({:ok, {:ok, result}}), do: {:ok, result}
  defp unwrap_transacted_result({:ok, {:error, reason}}), do: {:error, reason}
  defp unwrap_transacted_result(other), do: other

  defp default_atom_attrs do
    %{
      "label" => "",
      "radius" => 72.0,
      "fill_color" => "#76d2ff",
      "stroke_color" => "#15466a"
    }
  end

  defp default_annotation_attrs do
    %{
      "width" => 320.0,
      "height" => 180.0,
      "fill_color" => "#fff6b2"
    }
  end
end
