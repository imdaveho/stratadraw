defmodule Stratadraw.Patterns.PatternUser do
  use Ecto.Schema
  import Ecto.Changeset

  alias Stratadraw.Accounts.User
  alias Stratadraw.Patterns.Pattern

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "pattern_users" do
    field(:role, :string, default: "editor")
    field(:color, :string)

    belongs_to(:pattern, Pattern)
    belongs_to(:user, User)

    timestamps(type: :utc_datetime)
  end

  def changeset(pattern_user, attrs) do
    pattern_user
    |> cast(attrs, [:role, :color, :pattern_id, :user_id])
    |> validate_required([:role, :color, :pattern_id, :user_id])
    |> validate_inclusion(:role, ["owner", "editor"])
    |> unique_constraint([:pattern_id, :user_id])
  end
end
