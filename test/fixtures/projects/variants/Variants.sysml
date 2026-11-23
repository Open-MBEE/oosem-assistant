package VariantTest {
    private import RecursiveDecompositionPattern::Metadata::*;

    #blackbox part def Mk1_bb {
        #blackbox gear : Gear_bb;
    }
    #blackbox part def Mk2_bb :> Mk1_bb;

    #graybox part def Mk1_gb :> Mk2_bb {
        #graybox part gearSet :>> gear : Gear_gb;
    }
    #graybox part def Mk2_gb :> Mk1_gb;

    #whitebox part def Mk1_wb :> Mk2_gb {
        #whitebox gearTrain :>> gearSet : Gear_wb;
    }
    #whitebox part def Mk2_wb :> Mk1_wb;

    #blackbox part def Gear_bb;
    #graybox part def Gear_gb :> Gear_bb;
    #whitebox part def Gear_wb :> Gear_gb;
}
