# MemProtMD on AWS

MemProtMD is a database of every membrane protein structure in the Protein Data Bank (PDB), each inserted into a lipid bilayer by coarse-grained molecular dynamics (MD) self-assembly. For each structure, a DPPC bilayer assembles around the protein over 1 µs, using the MARTINI force field. The final 800 ns are analysed, and the final frame is converted to atomistic detail with CG2AT. The result is a consistent, simulation-based view of how ~9,500 membrane proteins sit in a membrane: their position and orientation, how they thin or thicken the bilayer, and which residues touch lipid head groups, lipid tails or water.

- **Website:** https://stansfeldlab.github.io/memprotmd/
- **Tutorial:** [Get To Know A Dataset: MemProtMD](get-to-know-a-dataset.ipynb)
- **Licence:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- **Citation:** Newport TD, Sansom MSP, Stansfeld PJ (2019). The MemProtMD database: a resource for membrane-embedded protein structures and their lipid interactions. *Nucleic Acids Research* 47(D1):D390–D397. [doi:10.1093/nar/gky1047](https://doi.org/10.1093/nar/gky1047)
- **Updates:** new PDB membrane protein structures are simulated as they are released, typically weekly.

> **Draft.** The bucket name and region below (`s3://memprotmd`, `eu-north-1`) are placeholders until the bucket is created.

## Accessing the data

The bucket is public and needs no AWS account:

```sh
aws s3 ls --no-sign-request s3://memprotmd/
aws s3 cp --no-sign-request s3://memprotmd/catalog/entries.tsv .
aws s3 sync --no-sign-request s3://memprotmd/simulations/1a0s_default_dppc/ 1a0s/
```

Every object can also be read over HTTPS, for example `https://memprotmd.s3.eu-north-1.amazonaws.com/catalog/entries.tsv`.

## Layout

```
s3://memprotmd/
├── README.md                      this documentation
├── LICENSE.txt                    CC BY 4.0
├── manifest.tsv                   every object, with its size
├── catalog/
│   ├── entries.tsv                one row per simulation: the place to start
│   └── residues.parquet           one row per residue of every simulation (~11 million rows)
├── simulations/
│   └── <pdb>_default_dppc/        one folder per simulation, e.g. 1a0s_default_dppc/
│       ├── images/                rendered pictures
│       ├── files/structures/      PDB-format snapshots
│       ├── files/contacts/        per-residue analysis (CSV)
│       ├── files/run/             GROMACS inputs to rerun the simulation
│       └── *.latest.yml           analysis results (YAML)
├── databases/
│   ├── PDB/thumbs/                one image per entry
│   ├── <collection>/thumbs/       montages for MemProtMD, TCDB, mpstruc and Pfam groups
│   ├── mpm/stats.csv              bilayer thickness histograms per MemProtMD group
│   └── cgdb/status.latest.yml     pipeline status of every PDB code considered
└── ensembles/statistics/          statistics across all simulations (YAML)
```

`<pdb>` is the PDB ID in lower case. Older entries use the four-character code (`1a0s`). Newer ones use the PDB's extended ID (`pdb_000010db`), and for those `pdb_0000` + code and the short code are the same structure. Every simulation so far uses a pure DPPC bilayer, hence `_default_dppc`.

## Files for each simulation

Under `simulations/<pdb>_default_dppc/`:

| Path | Format | Contents |
| --- | --- | --- |
| `files/structures/ready.pdb` | PDB | Protein as prepared for simulation |
| `files/structures/cg.pdb` | PDB | Final coarse-grained (MARTINI) frame: protein, lipids, water and ions |
| `files/structures/at.pdb` | PDB | Final frame converted to atomistic detail (CG2AT) |
| `files/structures/web_vis.pdb` | PDB | Reduced atomistic frame: protein and lipid phosphates, for viewers |
| `files/structures/distortions.pdb` | PDB | Average lipid phosphate surface, one pseudo-atom per grid point |
| `files/structures/group_head.contacts.pdb`, `group_tail…`, `group_solvent…` | PDB | Protein with contact fractions in the temperature-factor column |
| `files/contacts/by_resid_postprocess.csv` | CSV | Per-residue contacts and positions (see below) |
| `files/contacts/relative_z_histogram.csv` | CSV | Residue density along the membrane normal |
| `files/run/cg.zip`, `files/run/at.zip` | ZIP | GROMACS topology, coordinates and parameters to rerun the coarse-grained or atomistic system |
| `thinning.latest.yml` | YAML | Bilayer thickness far from (bulk) and next to (annular) the protein |
| `*.latest.yml` (others) | YAML | Further analysis, e.g. secondary-structure topology (`build_ss_topology`), alignment (`align_sim_structure`) |
| `images/front-distortions.jpg`, `top-…`, `bottom-…` | JPEG | Membrane surface coloured by thickness |
| `images/front-cg_lipids.jpg`, `front-at_lipids.jpg`, `front-cartoon.jpg` | JPEG | Protein with coarse-grained or atomistic lipids, or alone |
| `images/front-contacts-{head,tail,solvent}-{cartoon,surface}.jpg` | JPEG | Protein coloured by contact |
| `images/thumb_50.jpg`, `thumb_100.jpg`, `thumb_250.jpg` | JPEG | Small renders |

Trajectories are not in the bucket. MemProtMD's trajectories are deposited in the [MDDB](https://oxford.mddbr.eu/#/browse?option=MemProtMD) instead.

## Data dictionary

### `catalog/entries.tsv`

One row per simulation, tab-separated. Multi-valued fields are separated by `; `.

| Column | Meaning |
| --- | --- |
| `pdb_id` | PDB ID, lower case |
| `title` | Short title of the structure |
| `method` | Experimental method, as the PDB gives it |
| `resolution_A` | Resolution, Å (blank for NMR and some EM) |
| `released` | PDB release date |
| `uniprot` | UniProt accessions of the chains in the membrane |
| `organism`, `ncbi_taxid`, `domain` | Source organism(s), NCBI taxonomy IDs and domain of life |
| `n_chains`, `n_lipids`, `n_protein_residues` | Size of the simulated system |
| `bulk_thickness_A` | Bilayer thickness away from the protein, Å (phosphate to phosphate) |
| `annular_thickness_A` | Bilayer thickness next to the protein, Å |
| `thickness_change_A` | Annular minus bulk thickness, Å; negative means the protein thins the membrane |
| `memprotmd_groups` | MemProtMD classification, e.g. `alpha_helical`, `beta_barrel`, `gpcrs` |
| `mpstruc`, `tcdb`, `pfam` | mpstruc group, Transporter Classification (TC) numbers and Pfam families |
| `entry_url`, `record_url`, `files_url` | Web page, JSON record and folder of files for the entry |

### `catalog/residues.parquet`

One row per residue of every simulation, with columns gathered from each `by_resid_postprocess.csv`. Contacts are the fraction of analysed frames (0–1) in which the residue is within 6 Å of the group. Where a group has several beads, the fractions of its beads are summed.

| Column | Type | Meaning |
| --- | --- | --- |
| `pdb` | string | PDB ID |
| `chain`, `instance` | string, int16 | Chain ID, and copy number where the asymmetric unit repeats a chain |
| `resSeq`, `iCode`, `resName` | int32, string, string | PDB residue number, insertion code and name |
| `dssp` | string | Secondary structure (DSSP) |
| `z` | float32 | Position along the membrane normal, Å from the bilayer centre |
| `rel_z_annular` | float32 | The same, relative to the local (annular) bilayer centre |
| `head`, `tail`, `solvent` | float32 | Contact with lipid head groups, lipid tails and water + ions |
| `leaflet_a`, `leaflet_b`, `flip` | float32 | Contact with lipids of each leaflet, and with lipids that flip between them |
| `water`, `ions` | float32 | Contact with water and with ions |
| `choline`, `phosphate`, `glycerol` | float32 | Contact with each head-group bead |
| `tail_1` … `tail_4` | float32 | Contact with each tail bead, from the glycerol end (1) to the tail end (4) |

### `files/contacts/by_resid_postprocess.csv`

The source of `residues.parquet`, one per simulation, with more detail: contacts split by leaflet, lipid type and bead (`leaflet=a;resname=DPPC;bead=Phosphate`), and by group (`group=Head`, `group=Tail`, `group=Solvent`). It also has the residue's mean position (`x`, `y`, `z`), its position relative to each leaflet (`leaflet_upper`, `leaflet_lower`), solvent exposure (`surface`) and whether it lines a pore (`pore_inner_surface`).

### `thinning.latest.yml`

| Key | Meaning |
| --- | --- |
| `bulk_thickness`, `annular_thickness` | Thickness away from and next to the protein, Å |
| `thickness_diff` | Annular minus bulk, Å |
| `bulk_mid`, `annular_mid`, `mid_diff` | Bilayer centre in simulation coordinates, Å, and the shift next to the protein |

## Coordinates

All structures share one frame: the membrane normal is the z axis, and the bilayer centre is at the `bulk_mid` value of `thinning.latest.yml`, about z = 45 Å. In `residues.parquet`, `z` is already measured from the bilayer centre.
