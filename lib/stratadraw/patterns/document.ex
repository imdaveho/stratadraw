defmodule Stratadraw.Patterns.Document do
  use Ecto.Schema
  import Ecto.Changeset

  alias Stratadraw.Patterns.{Annotation, Atom, Pattern}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "documents" do
    field(:kind, :string)
    field(:markdown, :string, default: "")
    field(:ydoc_state, :binary)

    belongs_to(:pattern, Pattern)
    belongs_to(:atom, Atom)
    belongs_to(:annotation, Annotation)

    timestamps(type: :utc_datetime)
  end

  def changeset(document, attrs) do
    document
    |> cast(attrs, [:kind, :markdown, :ydoc_state, :pattern_id, :atom_id, :annotation_id])
    |> validate_required([:kind, :pattern_id])
    |> validate_inclusion(:kind, ["atom", "annotation"])
    |> validate_owner()
  end

  defp validate_owner(changeset) do
    atom_id = get_field(changeset, :atom_id)
    annotation_id = get_field(changeset, :annotation_id)

    cond do
      is_binary(atom_id) and is_nil(annotation_id) -> changeset
      is_binary(annotation_id) and is_nil(atom_id) -> changeset
      true -> add_error(changeset, :kind, "must belong to exactly one atom or annotation")
    end
  end
end
