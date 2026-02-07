import unittest

from fastapi.testclient import TestClient

from app import app


class OptionalOverrideTests(unittest.TestCase):
    def test_optional_override_none_strings_do_not_500(self) -> None:
        client = TestClient(app)
        response = client.get(
            "/calculate",
            params={
                "tp_cpp_employee_contrib_override": "None",
                "tp_ei_premiums_override": "None",
            },
        )
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
