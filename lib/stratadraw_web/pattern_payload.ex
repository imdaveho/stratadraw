defmodule StratadrawWeb.PatternPayload do
  alias Stratadraw.Accounts.User
  alias Stratadraw.Patterns.{Annotation, Atom, Bond, Document, Pattern, PatternUser}

  def board(%Pattern{} = pattern, %User{} = current_user) do
    %{
      current_user: %{id: current_user.id, email: current_user.email},
      pattern: pattern(pattern),
      members: Enum.map(pattern.pattern_users, &member/1),
      atoms: Enum.map(pattern.atoms, &atom/1),
      bonds: Enum.map(pattern.bonds, &bond/1),
      annotations: Enum.map(pattern.annotations, &annotation/1)
    }
  end

  def pattern(%Pattern{} = pattern) do
    %{id: pattern.id, name: pattern.name, description: pattern.description}
  end

  def member(%PatternUser{} = pattern_user) do
    %{
      id: pattern_user.id,
      user_id: pattern_user.user_id,
      email: pattern_user.user && pattern_user.user.email,
      role: pattern_user.role,
      color: pattern_user.color
    }
  end

  def atom(%Atom{} = atom) do
    %{
      id: atom.id,
      label: atom.label,
      x: atom.x,
      y: atom.y,
      radius: atom.radius,
      fill_color: atom.fill_color,
      stroke_color: atom.stroke_color,
      document: maybe_document(atom.document)
    }
  end

  def bond(%Bond{} = bond) do
    %{
      id: bond.id,
      label: bond.label,
      curvature: bond.curvature,
      source_atom_id: bond.source_atom_id,
      target_atom_id: bond.target_atom_id
    }
  end

  def annotation(%Annotation{} = annotation) do
    %{
      id: annotation.id,
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
      fill_color: annotation.fill_color,
      document: maybe_document(annotation.document)
    }
  end

  def document(%Document{} = document) do
    %{
      id: document.id,
      kind: document.kind,
      markdown: document.markdown || "",
      ydoc_state: Base.encode64(document.ydoc_state || <<>>),
      atom_id: document.atom_id,
      annotation_id: document.annotation_id
    }
  end

  defp maybe_document(nil), do: nil
  defp maybe_document(document), do: document(document)
end
