defmodule Stratadraw.Repo.Migrations.CreatePatternsGraphTables do
  use Ecto.Migration

  def change do
    create table(:patterns, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:name, :string, null: false)
      add(:description, :text)
      add(:owner_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false)

      timestamps(type: :utc_datetime)
    end

    create table(:pattern_users, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:role, :string, null: false, default: "editor")
      add(:color, :string, null: false)

      add(:pattern_id, references(:patterns, type: :binary_id, on_delete: :delete_all),
        null: false
      )

      add(:user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false)

      timestamps(type: :utc_datetime)
    end

    create(unique_index(:pattern_users, [:pattern_id, :user_id]))
    create(index(:pattern_users, [:user_id]))

    create table(:atoms, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:label, :string, null: false, default: "")
      add(:x, :float, null: false)
      add(:y, :float, null: false)
      add(:radius, :float, null: false, default: 72.0)
      add(:fill_color, :string, null: false, default: "#76d2ff")
      add(:stroke_color, :string, null: false, default: "#15466a")

      add(:pattern_id, references(:patterns, type: :binary_id, on_delete: :delete_all),
        null: false
      )

      timestamps(type: :utc_datetime)
    end

    create(index(:atoms, [:pattern_id]))

    create table(:annotations, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:x, :float, null: false)
      add(:y, :float, null: false)
      add(:width, :float, null: false, default: 320.0)
      add(:height, :float, null: false, default: 180.0)
      add(:fill_color, :string, null: false, default: "#fff6b2")

      add(:pattern_id, references(:patterns, type: :binary_id, on_delete: :delete_all),
        null: false
      )

      timestamps(type: :utc_datetime)
    end

    create(index(:annotations, [:pattern_id]))

    create table(:bonds, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:label, :string, null: false, default: "")
      add(:curvature, :float, null: false, default: 0.35)

      add(:pattern_id, references(:patterns, type: :binary_id, on_delete: :delete_all),
        null: false
      )

      add(:source_atom_id, references(:atoms, type: :binary_id, on_delete: :delete_all),
        null: false
      )

      add(:target_atom_id, references(:atoms, type: :binary_id, on_delete: :delete_all),
        null: false
      )

      timestamps(type: :utc_datetime)
    end

    create(index(:bonds, [:pattern_id]))
    create(index(:bonds, [:source_atom_id]))
    create(index(:bonds, [:target_atom_id]))

    create table(:documents, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:kind, :string, null: false)
      add(:markdown, :text, null: false, default: "")
      add(:ydoc_state, :binary)

      add(:pattern_id, references(:patterns, type: :binary_id, on_delete: :delete_all),
        null: false
      )

      add(:atom_id, references(:atoms, type: :binary_id, on_delete: :delete_all))
      add(:annotation_id, references(:annotations, type: :binary_id, on_delete: :delete_all))

      timestamps(type: :utc_datetime)
    end

    create(index(:documents, [:pattern_id]))
    create(unique_index(:documents, [:atom_id], where: "atom_id IS NOT NULL"))
    create(unique_index(:documents, [:annotation_id], where: "annotation_id IS NOT NULL"))
  end
end
