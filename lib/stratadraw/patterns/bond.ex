defmodule Stratadraw.Patterns.Bond do
  use Ecto.Schema
  import Ecto.Changeset

  alias Stratadraw.Patterns.{Atom, Pattern}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "bonds" do
    field(:label, :string, default: "")
    field(:curvature, :float, default: 0.35)

    belongs_to(:pattern, Pattern)
    belongs_to(:source_atom, Atom)
    belongs_to(:target_atom, Atom)

    timestamps(type: :utc_datetime)
  end

  def changeset(bond, attrs) do
    bond
    |> cast(attrs, [:label, :curvature, :pattern_id, :source_atom_id, :target_atom_id])
    |> validate_required([:curvature, :pattern_id, :source_atom_id, :target_atom_id])
    |> validate_number(:curvature, greater_than_or_equal_to: -1.5, less_than_or_equal_to: 1.5)
    |> validate_length(:label, max: 180)
  end
end
