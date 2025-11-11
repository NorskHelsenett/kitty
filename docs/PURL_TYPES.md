# Package URL (PURL) Types

Kitty's SBOM tooling looks for `pkg:<type>/...` identifiers when extracting Package URLs. Use this reference when crafting queries or writing prompts so the agent
knows what non-HTTP schemes to search for.

| Type (`pkg:type/...`) | Ecosystem / Meaning            | Example                                        |
|-----------------------|--------------------------------|------------------------------------------------|
| `apk`                 | Alpine Linux APK               | `pkg:apk/alpine/curl@8.1.2-r0`                 |
| `cargo`               | Rust crates.io                 | `pkg:cargo/rand@0.9.0`                         |
| `composer`            | PHP Composer                   | `pkg:composer/monolog/monolog@3.5.0`           |
| `deb`                 | Debian package                 | `pkg:deb/debian/curl@7.88.1-10`                |
| `gem`                 | RubyGems                       | `pkg:gem/rails@7.1.3`                          |
| `generic`             | Generic artifact               | `pkg:generic/acme/widget@1.4.2?download_url=`  |
| `github`, `bitbucket` | Git repositories               | `pkg:github/hashicorp/consul@v1.15.4`          |
| `githubactions`       | GitHub Actions workflow        | `pkg:githubactions/actions/checkout@v4`        |
| `golang`              | Go modules                     | `pkg:golang/github.com/gin-gonic/gin@1.9.1`    |
| `hex`                 | Erlang/Elixir Hex packages     | `pkg:hex/phoenix@1.7.10`                       |
| `maven`               | Maven Central / Java           | `pkg:maven/org.slf4j/slf4j-api@2.0.12`         |
| `npm`                 | JavaScript npm                 | `pkg:npm/react@18.3.1`                         |
| `nuget`               | .NET NuGet                     | `pkg:nuget/Newtonsoft.Json@13.0.3`             |
| `pypi`                | Python PyPI                    | `pkg:pypi/requests@2.32.0`                     |
| `rpm`                 | RedHat RPM                     | `pkg:rpm/redhat/openssl@3.0.9-18`              |
| `swift`               | Swift Package Manager          | `pkg:swift/github.com/apple/swift-nio@2.60.0`  |
| `docker`              | Container images               | `pkg:docker/library/nginx@1.25.5`              |

When in doubt, look for the literal `pkg:` prefix inside the SBOM. The new `scan_sbom_purls` tool surfaces these identifiers without streaming the file into
the conversation window, so agents can work with multi-megabyte SBOMs safely.
