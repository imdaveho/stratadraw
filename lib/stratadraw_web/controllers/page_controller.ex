defmodule StratadrawWeb.PageController do
  use StratadrawWeb, :controller

  def home(conn, _params) do
    render(conn, :home, page_title: "Open Schema")
  end

  def open_schema(conn, params) do
    case params |> schema_code_param() |> normalize_code() do
      nil ->
        conn
        |> put_flash(:error, "Enter a schema code to open a workspace.")
        |> redirect(to: ~p"/")

      code ->
        redirect(conn, to: ~p"/schemas/#{code}")
    end
  end

  def schema(conn, %{"code" => code}) do
    render(conn, :schema, schema_code: code, page_title: "Schema #{code}")
  end

  defp schema_code_param(%{"schema" => %{"code" => code}}), do: code
  defp schema_code_param(%{"code" => code}), do: code
  defp schema_code_param(_params), do: nil

  defp normalize_code(nil), do: nil

  defp normalize_code(code) do
    code
    |> String.trim()
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9_-]+/u, "-")
    |> String.trim("-")
    |> case do
      "" -> nil
      normalized -> normalized
    end
  end
end
