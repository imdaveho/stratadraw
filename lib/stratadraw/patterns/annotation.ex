defmodule Stratadraw.Patterns.Annotation do
  use Ecto.Schema
  import Ecto.Changeset

  alias Stratadraw.Patterns.{Document, Pattern}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "annotations" do
    field(:x, :float)
    field(:y, :float)
    field(:width, :float, default: 320.0)
    field(:height, :float, default: 180.0)
    field(:fill_color, :string, default: "#fff6b2")

    belongs_to(:pattern, Pattern)

    has_one(:document, Document)

    timestamps(type: :utc_datetime)
  end

  def changeset(annotation, attrs) do
    annotation
    |> cast(attrs, [:x, :y, :width, :height, :fill_color, :pattern_id])
    |> validate_required([:x, :y, :width, :height, :pattern_id])
    |> validate_number(:width, greater_than: 80.0, less_than: 900.0)
    |> validate_number(:height, greater_than: 60.0, less_than: 900.0)
  end
end
