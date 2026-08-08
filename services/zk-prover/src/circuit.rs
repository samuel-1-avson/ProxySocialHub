use halo2_proofs::{
    circuit::{Layouter, SimpleFloorPlanner, Value},
    pasta::Fp,
    plonk::{Advice, Circuit, Column, ConstraintSystem, Error, Instance},
};

pub const PROVER_K: u32 = 7;
pub const PROOF_SYSTEM: &str = "halo2-ipa-pasta-v2-batch-digest";
/// Public instance layout: digest_limb0..3, session_count, total_bytes.
pub const NUM_PUBLIC_INPUTS: usize = 6;

#[derive(Clone, Debug)]
pub struct BatchDigestConfig {
    advice: Column<Advice>,
    instance: Column<Instance>,
}

/// Circuit binds six public inputs (4 digest limbs + session_count + total_bytes).
#[derive(Clone, Debug, Default)]
pub struct BatchDigestCircuit {
    pub limbs: Option<[Fp; NUM_PUBLIC_INPUTS]>,
}

impl Circuit<Fp> for BatchDigestCircuit {
    type Config = BatchDigestConfig;
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        Self { limbs: None }
    }

    fn configure(meta: &mut ConstraintSystem<Fp>) -> Self::Config {
        let advice = meta.advice_column();
        let instance = meta.instance_column();
        meta.enable_equality(advice);
        meta.enable_equality(instance);
        BatchDigestConfig { advice, instance }
    }

    fn synthesize(
        &self,
        config: Self::Config,
        mut layouter: impl Layouter<Fp>,
    ) -> Result<(), Error> {
        let values: [Value<Fp>; NUM_PUBLIC_INPUTS] = match self.limbs {
            Some(limbs) => limbs.map(Value::known),
            None => [Value::unknown(); NUM_PUBLIC_INPUTS],
        };

        for (i, value) in values.into_iter().enumerate() {
            let assigned = layouter.assign_region(
                || format!("assign public limb {i}"),
                |mut region| region.assign_advice(|| "limb", config.advice, 0, || value),
            )?;
            layouter.constrain_instance(assigned.cell(), config.instance, i)?;
        }
        Ok(())
    }
}
