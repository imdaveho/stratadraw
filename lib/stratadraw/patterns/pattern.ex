defmodule Stratadraw.Patterns.Pattern do
  use Ecto.Schema
  import Ecto.Changeset

  alias Stratadraw.Accounts.User
  alias Stratadraw.Patterns.{Annotation, Atom, Bond, Document, PatternUser}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "patterns" do
    field(:name, :string)
    field(:description, :string)

    belongs_to(:owner, User)

    has_many(:pattern_users, PatternUser)
    has_many(:atoms, Atom)
    has_many(:bonds, Bond)
    has_many(:annotations, Annotation)
    has_many(:documents, Document)

    timestamps(type: :utc_datetime)
  end

  def changeset(pattern, attrs) do
    pattern
    |> cast(attrs, [:name, :description, :owner_id])
    |> validate_required([:name, :owner_id])
    |> validate_length(:name, max: 120)
    |> validate_length(:description, max: 1_000)
  end
end
