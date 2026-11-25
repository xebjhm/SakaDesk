from backend.services.memories.names import normalize_member_name


def test_normalize_spaces_and_width():
    assert normalize_member_name("金村 美玖") == "金村美玖"
    assert normalize_member_name("金村　美玖") == "金村美玖"
    assert normalize_member_name("ＫＡＮＥＭＵＲＡ") == "KANEMURA"


def test_normalize_group_suffix():
    assert normalize_member_name("松田好花（日向坂46）") == "松田好花"
    assert normalize_member_name("松田好花(日向坂46)") == "松田好花"
