defmodule StratadrawWeb.PageController do
  use StratadrawWeb, :controller

  def home(conn, _params) do
    if conn.assigns.current_scope && conn.assigns.current_scope.user do
      redirect(conn, to: ~p"/patterns")
    else
      render(conn, :home)
    end
  end
end
