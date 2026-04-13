defmodule Stratadraw.Patterns.Atom do
  use Ecto.Schema
  import Ecto.Changeset

  alias Stratadraw.Patterns.{Bond, Document, Pattern}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "atoms" do
    field(:label, :string, default: "")
    field(:x, :float)
    field(:y, :float)
    field(:radius, :float, default: 72.0)
    field(:fill_color, :string, default: "#76d2ff")
    field(:stroke_color, :string, default: "#15466a")

    belongs_to(:pattern, Pattern)

    has_one(:document, Document)
    has_many(:outgoing_bonds, Bond, foreign_key: :source_atom_id)
    has_many(:incoming_bonds, Bond, foreign_key: :target_atom_id)

    timestamps(type: :utc_datetime)
  end

  def changeset(atom, attrs) do
    atom
    |> cast(attrs, [:label, :x, :y, :radius, :fill_color, :stroke_color, :pattern_id])
    |> validate_required([:x, :y, :radius, :pattern_id])
    |> validate_number(:radius, greater_than: 8.0, less_than: 300.0)
    |> validate_length(:label, max: 180)
  end
end
