from algorank_ingest.startgg import queries
from algorank_ingest.startgg.gql import (
    QuerySpec,
    classify_graphql_error,
    is_complexity_error,
)


def test_render_basic():
    spec = QuerySpec(
        "Q",
        {"id": "ID!"},
        {"event": {"__args": {"id": "$id"}, "id": None, "name": None}},
    )
    doc = spec.render()
    assert "query Q($id: ID!)" in doc
    assert "event(id: $id)" in doc
    assert "name" in doc


def test_render_nested_args():
    spec = queries.tournaments_window()
    doc = spec.render()
    assert "tournaments(query: {page: $page, perPage: $perPage" in doc
    assert "filter: {videogameIds: [$videogameId], afterDate: $afterDate, beforeDate: $beforeDate}" in doc
    assert "pageInfo" in doc


def test_drop_field_everywhere():
    spec = queries.event_sets_page()
    assert "vodUrl" in spec.render()
    assert spec.drop_field("vodUrl")
    assert "vodUrl" not in spec.render()
    # dropping again is a no-op
    assert not spec.drop_field("vodUrl")


def test_drop_argument_nested():
    spec = queries.event_sets_page()
    assert "showByes" in spec.render()
    assert spec.drop_argument("showByes")
    assert "showByes" not in spec.render()
    # empty filters object no longer rendered
    assert "filters: {}" not in spec.render()


def test_drop_variable():
    spec = queries.tournaments_window()
    assert spec.drop_variable("beforeDate")
    assert "$beforeDate: Timestamp!" not in spec.render()


def test_classify_errors():
    assert classify_graphql_error('Cannot query field "vodUrl" on type "Set".') == ("field", "vodUrl")
    assert classify_graphql_error('Unknown argument "filters" on field "sets".') == ("argument", "filters")
    assert classify_graphql_error('Field "updatedAfter" is not defined by type SetFilters.') == (
        "argument",
        "updatedAfter",
    )
    assert classify_graphql_error('Variable "$beforeDate" is never used in operation "Q".') == (
        "variable",
        "beforeDate",
    )
    assert classify_graphql_error("Some other error") is None


def test_complexity_detection():
    assert is_complexity_error(
        "Query complexity too high. A maximum of 1000 objects may be returned by each request. (actual: 1235)"
    )
    assert not is_complexity_error('Cannot query field "x"')


def test_all_query_builders_render():
    for builder in (
        queries.tournaments_window,
        queries.event_detail,
        queries.event_sets_page,
        queries.phase_group_sets_page,
        queries.event_entrants_page,
        queries.event_standings_page,
        queries.phase_seeds_page,
        queries.videogame_check,
    ):
        doc = builder().render()
        assert doc.startswith("query ")
        assert doc.count("{") == doc.count("}")
