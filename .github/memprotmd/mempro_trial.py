#!/usr/bin/env python3
"""Trial: can MemPrO, MemPrOD and Insane4MemPrO set a PDB entry up on a GitHub runner?

For one PDB code this fetches the structure from the RCSB PDB, keeps the protein of biological
assembly 1, and runs, timing each stage:

  1. MemPrO          orientation in the membrane, and the per-chain topology
  2. MemPrOD         predicted membrane deformations around the oriented protein
  3. martinize2      coarse-grained (Martini 3) protein from the oriented structure
  4. Insane4MemPrO   coarse-grained protein, membrane and solvent, with MemPrOD's deformations

Nothing is published: the outputs and result.json (times, sizes, errors) are left in the output
folder for the workflow to keep as an artifact. A stage that fails is recorded and later stages
that do not need it still run.

Usage: mempro_trial.py PDB_CODE OUT_DIR [--cpus N]
"""
import argparse, glob, gzip, json, os, shutil, subprocess, sys, time, urllib.request

UA = {'User-Agent': 'memprotmd-mempro-trial (+https://stansfeldlab.github.io/memprotmd/)'}
STAGE_LIMIT = {'mempro': 90 * 60, 'memprod': 30 * 60, 'martinize2': 30 * 60, 'insane4mempro': 30 * 60}


def size(path):
    if os.path.isfile(path):
        return os.path.getsize(path)
    return sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs) if os.path.isdir(path) else 0


def run(result, name, cmd, cwd):
    """Runs one stage, recording its time, exit code and the end of its output."""
    t0 = time.time()
    rec = {'cmd': ' '.join(cmd)}
    try:
        p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=STAGE_LIMIT[name])
        rec['exit'], out = p.returncode, p.stdout
    except subprocess.TimeoutExpired as e:
        rec['exit'], out = 'timeout', (e.stdout or b'').decode('utf-8', 'replace') if isinstance(e.stdout, bytes) else (e.stdout or '')
    except FileNotFoundError as e:
        rec['exit'], out = 'not installed', str(e)
    rec['seconds'] = round(time.time() - t0, 1)
    with open(os.path.join(cwd, name + '.log'), 'w') as f:
        f.write(out)
    if rec['exit'] != 0:
        rec['log_tail'] = out[-1500:]
    result['stages'][name] = rec
    print('%s: exit %s in %.0f s' % (name, rec['exit'], rec['seconds']), flush=True)
    return rec['exit'] == 0


def prepare(pid, out, result):
    """Protein of biological assembly 1 (or the deposited chains if that cannot be built), as a PDB file."""
    import gemmi
    cif = os.path.join(out, pid + '.cif')
    req = urllib.request.Request('https://files.rcsb.org/download/%s.cif' % pid.upper(), headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(cif, 'wb') as f:
        shutil.copyfileobj(r, f)
    st = gemmi.read_structure(cif)
    st.setup_entities()
    while len(st) > 1:
        del st[1]
    st.remove_alternative_conformations()
    st.remove_hydrogens()
    st.remove_ligands_and_waters()
    st.remove_empty_chains()
    result['assembly'] = 'deposited chains'
    if len(st.assemblies):
        try:
            st.transform_to_assembly(st.assemblies[0].name, gemmi.HowToNameCopiedChain.Short)
            result['assembly'] = 'assembly ' + st.assemblies[0].name
        except Exception as e:   # more chains than one-letter names, usually
            result['assembly_error'] = str(e)[:200]
    st.shorten_chain_names()
    st.setup_entities()
    model = st[0]
    result['chains'] = len(model)
    result['residues'] = sum(len(ch) for ch in model)
    pdb = os.path.join(out, 'protein.pdb')
    st.write_pdb(pdb)
    os.remove(cif)
    return pdb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdb'); ap.add_argument('out'); ap.add_argument('--cpus', type=int, default=os.cpu_count() or 2)
    a = ap.parse_args()
    pid, out = a.pdb.lower(), os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    result = {'pdb': pid, 'cpus': a.cpus, 'stages': {}, 'sizes': {}}
    t_all = time.time()
    try:
        t0 = time.time()
        prepare(pid, out, result)
        result['stages']['prepare'] = {'exit': 0, 'seconds': round(time.time() - t0, 1)}
    except Exception as e:
        result['stages']['prepare'] = {'exit': 1, 'log_tail': repr(e)[:1500]}
    else:
        oriented = os.path.join(out, 'oriented.pdb')
        if run(result, 'mempro', ['mempro', '-f', 'protein.pdb', '-o', 'Orient/', '-nc', str(a.cpus)], out):
            src = os.path.join(out, 'Orient', 'Rank_1', 'oriented_rank_1.pdb')
            if os.path.exists(src):
                with open(src) as f, open(oriented, 'w') as g:
                    g.writelines(l for l in f if 'DUM' not in l)   # MemPrO's dummy membrane beads
            info = os.path.join(out, 'Orient', 'Rank_1', 'info_rank_1.txt')
            if os.path.exists(info):
                result['mempro_info'] = open(info).read()[:1200]
        if os.path.exists(oriented):
            run(result, 'memprod', ['MemPrOD', '-f', 'oriented.pdb', '-o', 'Deformations/'], out)
            if run(result, 'martinize2', ['martinize2', '-f', 'oriented.pdb', '-x', 'protein-cg.pdb', '-o', 'protein-cg.top', '-ff', 'martini3001',
                                          '-dssp', '-elastic', '-ignh', '-maxwarn', '1000'], out):
                # box: the protein's extent plus 8 nm in the plane and 10 nm along z, as MemPrO's own build does
                xyz = [[float(l[30:38]), float(l[38:46]), float(l[46:54])] for l in open(os.path.join(out, 'protein-cg.pdb')) if l.startswith(('ATOM', 'HETATM'))]
                box = [round((max(c) - min(c)) / 10.0 + pad, 1) for c, pad in zip(zip(*xyz), (8, 8, 10))]
                cmd = ['insane4mempro', '-f', 'protein-cg.pdb', '-o', 'CG-system.gro', '-p', 'topol.top', '-x', str(box[0]), '-y', str(box[1]), '-z', str(box[2]),
                       '-sol', 'W', '-l', 'DPPC', '-negi_c0', 'CL', '-posi_c0', 'NA']
                md = glob.glob(os.path.join(out, 'Deformations', '**', 'Membrane_Data'), recursive=True)
                if md:
                    cmd += ['-def', os.path.relpath(md[0], out)]
                result['deformed_build'] = bool(md)
                run(result, 'insane4mempro', cmd, out)
    result['total_seconds'] = round(time.time() - t_all, 1)
    # MemPrO writes every ranked orientation; only the best is kept in the artifact (the full size is still reported)
    result['sizes']['orient_all_ranks'] = size(os.path.join(out, 'Orient'))
    for d in glob.glob(os.path.join(out, 'Orient', 'Rank_*')):
        if os.path.basename(d) != 'Rank_1':
            shutil.rmtree(d, ignore_errors=True)
    for label, path in (('topology', 'Orient/Rank_1/Topology'), ('oriented_pdb', 'oriented.pdb'), ('orient_folder', 'Orient'), ('deformations', 'Deformations'),
                        ('cg_protein', 'protein-cg.pdb'), ('cg_system', 'CG-system.gro')):
        result['sizes'][label] = size(os.path.join(out, path))
    # the big text files are kept gzipped, so the artifact shows what storing them would cost
    for path in ('oriented.pdb', 'CG-system.gro', 'protein.pdb'):
        full = os.path.join(out, path)
        if os.path.exists(full):
            with open(full, 'rb') as f, gzip.open(full + '.gz', 'wb') as g:
                shutil.copyfileobj(f, g)
            os.remove(full)
            result['sizes'][path + '.gz'] = os.path.getsize(full + '.gz')
    with open(os.path.join(out, 'result.json'), 'w') as f:
        json.dump(result, f, indent=1)
    print(json.dumps({k: v for k, v in result.items() if k != 'mempro_info'}, indent=1)[:3000])


if __name__ == '__main__':
    sys.exit(main())
