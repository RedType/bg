{
  description = "yet another internet backgammon";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    utils.url = "github:numtide/flake-utils";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, utils, rust-overlay, flake-compat }:
    let
      name = "tagbot";
      NYI = builtins.throw "This feature is NYI";
    in utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [
            rust-overlay.overlay
            (self: super: {
              rustc = self.rust-bin.stable.latest.default;
              cargo = self.rust-bin.stable.latest.default;
            })
          ];
        };

        # runtime dependencies
        buildInputs = with pkgs; [
        ];

        # buildtime dependencies
        nativeBuildInputs = with pkgs; [
          cargo
          docker
          lldb
          nixpkgs-fmt
          pkgconfig
          rustc
        ];

        buildEnvVars = {
        };
      in rec {
        # `$ nix build`
        packages.${name} = NYI;
        defaultPackage = packages.${name};

        # `$ nix run`
        apps.${name} = NYI;
        defaultApp = apps.${name};

        # `$ nix develop`
        devShell = pkgs.mkShell {
          inherit buildInputs nativeBuildInputs;
          RUST_SRC_PATH = "${pkgs.rust.packages.stable.rustPlatform.rustLibSrc}";
        } // buildEnvVars;
      }
    )
  ;
}

