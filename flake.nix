{
  description = "A Nix-flake-based Rust development environment";

  inputs = {
    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1"; # unstable Nixpkgs
    fenix = {
      url = "https://flakehub.com/f/nix-community/fenix/0.1";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { self, ... }@inputs:

    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forEachSupportedSystem =
        f:
        inputs.nixpkgs.lib.genAttrs supportedSystems (
          system:
          f {
            inherit system;
            pkgs = import inputs.nixpkgs {
              inherit system;
              overlays = [
                inputs.self.overlays.default
              ];
            };
          }
        );
    in
    {
      overlays.default = final: prev: {
        rustToolchain =
          with inputs.fenix.packages.${prev.stdenv.hostPlatform.system};
          combine (
            with stable;
            [
              clippy
              rustc
              cargo
              rustfmt
              rust-src
            ]
          );
      };

      devShells = forEachSupportedSystem (
        { pkgs, system }:
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              rustToolchain
              openssl
              pkg-config
              cargo-deny
              cargo-edit
              cargo-watch
              rust-analyzer
              sqlx-cli
              just
              # Frontend toolchain
              nodejs_22
              pnpm
              # Local database
              postgresql_16
              self.formatter.${system}
            ];

            env = {
              # Required by rust-analyzer
              RUST_SRC_PATH = "${pkgs.rustToolchain}/lib/rustlib/src/rust/library";
              # web-push (hyper-tls, ece) dinamik ravishda OpenSSL'ga bog'lanadi.
              # Ishga tushish vaqtida libssl.so.3 topilishi uchun lib yo'lini beramiz,
              # aks holda backend "libssl.so.3 not found" bilan qulaydi (→ Bad Gateway).
              LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.openssl ];
              # Local dev database connection
              DATABASE_URL = "postgres://challanger:challanger@localhost:5433/challanger";
              PGDATA = "./.pg/data";
              PGHOST = "localhost";
              PGPORT = "5433";
              # Dev uchun JWT maxfiy kaliti (productionda o'zgartiring!)
              JWT_SECRET = "dev-secret-challanger-2026";
            };
          };
        }
      );

      formatter = forEachSupportedSystem ({ pkgs, ... }: pkgs.nixfmt);
    };
}
